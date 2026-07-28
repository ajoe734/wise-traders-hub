// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file no-explicit-any
// tw-bsr-daily-sync
// 抓 TWSE BSR（分點買賣超）→ 落地 tw_bsr_daily → 重算 tw_chips_rollup
//
// 呼叫方式：
//   POST { mode: "queue", batch?: 8, window?: "off_hours" }
//        → 從優先級佇列取 batch 檔（跳過尚未到 next_retry_at 的），跑排程模式
//   POST { mode: "backfill", batch?: 6, lookback?: 7 }
//        → 高頻補跑：只挑 tw_bsr_fetch_failures 裡「未 resolved 且 next_retry_at 已到期」的股票，
//          直到每支拿到 last_successful 為止；忽略 off-hours 冷凍條件。
//   POST { stock_ids: [...] , date?, lookback? }
//        → 手動指定股票（優先於 queue）
//
// 六層防禦：
//   1. 分散鎖：同一時間只有一個實例在跑
//   2. 每檔隨機 sleep 2.5–5s；OCR 重試 1.2–2.5s
//   3. 隨機 UA + Referer 鏈
//   4. Cookie jar 每 6 檔輪替
//   5. 指數退避：失敗寫 next_retry_at，下次 cron 才會再抓
//   6. 每輪彙總指標到 tw_bsr_sync_metrics（15 分鐘桶）

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ocrTwseCaptchaDetailed, planWithPriority, type OcrResult, type OcrVariantName } from "../_shared/twOcr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BSR_HOST = "https://bsr.twse.com.tw";
const BSR_MENU = `${BSR_HOST}/bshtm/bsMenu.aspx`;
const LOCK_KEY = "tw-bsr-daily-sync";

// ---- 動態設定：tw_bsr_sync_config（key='bsr_sync'）→ 可熱調且有版本歷史 ----
interface BackfillConfig {
  batch: number;              // 每輪回補預設批次量
  lookback: number;           // 每檔回補嘗試往回推的交易日數
  batch_max: number;          // 前端/呼叫端可覆寫的上限
  lookback_max: number;       // 同上，避免過深爬取
  max_runs_per_hour: number;  // 高頻週期上限：每小時最多執行 backfill 次數（0=不限）
  max_attempts_per_day: number; // 單一 stock+trade_date 累積失敗達到即進入資料冷卻
  cooldown_hours: number;       // 冷卻時數：達 max_attempts_per_day 後 next_retry_at 至少延後這麼久
}

interface AdaptiveConfig {
  enabled: boolean;
  /** 觸發把 fast → standard 的 consecutive_failures 門檻 */
  escalate_to_standard_at: number;
  /** 觸發把任意模式 → aggressive 的 consecutive_failures 門檻 */
  escalate_to_aggressive_at: number;
  /** 觸發把預處理變體（otsu/adaptive/dilate）插到最前面的 consecutive_failures 門檻 */
  reorder_variants_at: number;
  /** 觸發 exhaustive（跑完所有變體不短路）的 consecutive_failures 門檻 */
  exhaustive_at: number;
  /** 若 true，觸發 escalate 後最後一次 OCR 重試會再升級一階（與舊 ocr_escalate_on_fail 相容） */
  escalate_on_last_retry: boolean;
}

interface SyncConfig {
  ua_pool: string[];
  accept_lang_pool: string[];
  max_ocr_retry: number;
  ocr_retry_sleep_ms: [number, number];
  per_stock_sleep_ms: [number, number];
  backoff_steps_sec: number[];
  max_consecutive_before_freeze: number;
  freeze_window_ms: number;
  cookie_jar_reuse: number;
  lock_ttl_sec: number;
  ocr_mode: "fast" | "standard" | "aggressive";
  ocr_escalate_on_fail: boolean;
  adaptive: AdaptiveConfig;
  backfill: BackfillConfig;
}

const DEFAULT_ADAPTIVE: AdaptiveConfig = {
  enabled: true,
  escalate_to_standard_at: 1,
  escalate_to_aggressive_at: 2,
  reorder_variants_at: 3,
  exhaustive_at: 5,
  escalate_on_last_retry: true,
};

const DEFAULT_CONFIG: SyncConfig = {
  ua_pool: [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  ],
  accept_lang_pool: ["zh-TW,zh;q=0.9,en;q=0.8", "zh-TW,zh-Hant;q=0.9,en;q=0.7", "zh-TW;q=0.9,zh;q=0.8"],
  max_ocr_retry: 3,
  ocr_retry_sleep_ms: [1200, 2500],
  per_stock_sleep_ms: [2500, 5000],
  backoff_steps_sec: [60, 300, 1800, 7200, 21600],
  max_consecutive_before_freeze: 4,
  freeze_window_ms: 86400000,
  cookie_jar_reuse: 6,
  lock_ttl_sec: 90,
  ocr_mode: "standard",
  ocr_escalate_on_fail: true,
  adaptive: DEFAULT_ADAPTIVE,
  backfill: {
    batch: 6,
    lookback: 7,
    batch_max: 20,
    lookback_max: 10,
    max_runs_per_hour: 6,
    max_attempts_per_day: 8,
    cooldown_hours: 12,
  },
};

function normAdaptive(raw: any, fb: AdaptiveConfig): AdaptiveConfig {
  const src = raw && typeof raw === "object" ? raw : {};
  const pick = (k: keyof AdaptiveConfig, min: number) => {
    const n = Number((src as any)[k]);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : (fb as any)[k];
  };
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : fb.enabled,
    escalate_to_standard_at: pick("escalate_to_standard_at", 0),
    escalate_to_aggressive_at: pick("escalate_to_aggressive_at", 0),
    reorder_variants_at: pick("reorder_variants_at", 0),
    exhaustive_at: pick("exhaustive_at", 0),
    escalate_on_last_retry: typeof src.escalate_on_last_retry === "boolean"
      ? src.escalate_on_last_retry : fb.escalate_on_last_retry,
  };
}


function normBackfill(raw: any, fallback: BackfillConfig): BackfillConfig {
  const src = raw && typeof raw === "object" ? raw : {};
  const pick = (k: keyof BackfillConfig, min: number) => {
    const n = Number(src[k]);
    return Number.isFinite(n) && n >= min ? n : fallback[k];
  };
  return {
    batch: Math.max(1, Math.floor(pick("batch", 1))),
    lookback: Math.max(1, Math.floor(pick("lookback", 1))),
    batch_max: Math.max(1, Math.floor(pick("batch_max", 1))),
    lookback_max: Math.max(1, Math.floor(pick("lookback_max", 1))),
    max_runs_per_hour: Math.max(0, Math.floor(pick("max_runs_per_hour", 0))),
    max_attempts_per_day: Math.max(1, Math.floor(pick("max_attempts_per_day", 1))),
    cooldown_hours: Math.max(1, Math.floor(pick("cooldown_hours", 1))),
  };
}



async function loadConfig(supa: any): Promise<{ cfg: SyncConfig; version: number | null }> {
  try {
    const { data } = await supa
      .from("tw_bsr_sync_config")
      .select("config, version")
      .eq("key", "bsr_sync")
      .maybeSingle();
    if (!data?.config) return { cfg: DEFAULT_CONFIG, version: null };
    const raw = data.config as Partial<SyncConfig>;
    const cfg: SyncConfig = {
      ua_pool: Array.isArray(raw.ua_pool) && raw.ua_pool.length ? raw.ua_pool : DEFAULT_CONFIG.ua_pool,
      accept_lang_pool: Array.isArray(raw.accept_lang_pool) && raw.accept_lang_pool.length
        ? raw.accept_lang_pool : DEFAULT_CONFIG.accept_lang_pool,
      max_ocr_retry: Number(raw.max_ocr_retry) > 0 ? Number(raw.max_ocr_retry) : DEFAULT_CONFIG.max_ocr_retry,
      ocr_retry_sleep_ms: normPair(raw.ocr_retry_sleep_ms, DEFAULT_CONFIG.ocr_retry_sleep_ms),
      per_stock_sleep_ms: normPair(raw.per_stock_sleep_ms, DEFAULT_CONFIG.per_stock_sleep_ms),
      backoff_steps_sec: Array.isArray(raw.backoff_steps_sec) && raw.backoff_steps_sec.length
        ? raw.backoff_steps_sec.map((n) => Number(n)).filter((n) => n > 0)
        : DEFAULT_CONFIG.backoff_steps_sec,
      max_consecutive_before_freeze: Number(raw.max_consecutive_before_freeze) > 0
        ? Number(raw.max_consecutive_before_freeze) : DEFAULT_CONFIG.max_consecutive_before_freeze,
      freeze_window_ms: Number(raw.freeze_window_ms) > 0
        ? Number(raw.freeze_window_ms) : DEFAULT_CONFIG.freeze_window_ms,
      cookie_jar_reuse: Number(raw.cookie_jar_reuse) > 0
        ? Number(raw.cookie_jar_reuse) : DEFAULT_CONFIG.cookie_jar_reuse,
      lock_ttl_sec: Number(raw.lock_ttl_sec) > 0
        ? Number(raw.lock_ttl_sec) : DEFAULT_CONFIG.lock_ttl_sec,
      ocr_mode: (["fast", "standard", "aggressive"] as const).includes(raw.ocr_mode as any)
        ? (raw.ocr_mode as SyncConfig["ocr_mode"]) : DEFAULT_CONFIG.ocr_mode,
      ocr_escalate_on_fail: typeof raw.ocr_escalate_on_fail === "boolean"
        ? raw.ocr_escalate_on_fail : DEFAULT_CONFIG.ocr_escalate_on_fail,
      adaptive: normAdaptive((raw as any).adaptive, DEFAULT_ADAPTIVE),
      backfill: normBackfill((raw as any).backfill, DEFAULT_CONFIG.backfill),
    };
    return { cfg, version: Number(data.version) || null };
  } catch {
    return { cfg: DEFAULT_CONFIG, version: null };
  }
}
function normPair(v: any, fallback: [number, number]): [number, number] {
  if (!Array.isArray(v) || v.length < 2) return fallback;
  const a = Number(v[0]), b = Number(v[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) return fallback;
  return [a, b];
}

function randomFrom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function jitter(min: number, max: number) { return Math.floor(min + Math.random() * (max - min)); }
function jitterPair(pair: [number, number]) { return jitter(pair[0], pair[1]); }

function taipeiTodayISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

function parseSetCookie(headers: Headers): Record<string, string> {
  const jar: Record<string, string> = {};
  const raw = (headers as any).getSetCookie?.() || [];
  const list: string[] = Array.isArray(raw) && raw.length ? raw : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  for (const c of list) {
    const first = c.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return jar;
}
function jarToHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
function extractHidden(html: string, name: string): string {
  const re = new RegExp(`<input[^>]+name="${name}"[^>]+value="([^"]*)"`, "i");
  return html.match(re)?.[1] || "";
}
function extractCaptchaImageUrl(html: string): string | null {
  const m = html.match(/CaptchaImage\.aspx\?[^"'\s>]+/i);
  return m ? `${BSR_HOST}/bshtm/${m[0]}` : null;
}

interface BsrRow {
  broker_id: string; broker_name: string;
  buy_shares: number; sell_shares: number;
  avg_buy_price: number | null; avg_sell_price: number | null;
}

function parseBsContent(html: string): BsrRow[] {
  const rows: BsrRow[] = [];
  const map = new Map<string, BsrRow>();
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const inner = m[1];
    const tds = Array.from(inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) =>
      x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (tds.length < 5) continue;
    for (let i = 0; i + 4 < tds.length; i += 5) {
      const id = tds[i]; const name = tds[i + 1];
      const price = Number(tds[i + 2].replace(/,/g, ""));
      const buy = Number(tds[i + 3].replace(/,/g, ""));
      const sell = Number(tds[i + 4].replace(/,/g, ""));
      if (!id || !/^[0-9a-zA-Z]{3,6}$/.test(id)) continue;
      if (Number.isNaN(buy) && Number.isNaN(sell)) continue;
      const prev = map.get(id) || {
        broker_id: id, broker_name: name,
        buy_shares: 0, sell_shares: 0,
        avg_buy_price: null as number | null, avg_sell_price: null as number | null,
      };
      const b = Number.isFinite(buy) ? buy : 0;
      const s = Number.isFinite(sell) ? sell : 0;
      if (b > 0 && Number.isFinite(price)) {
        const prevBuy = prev.buy_shares; const prevPrice = prev.avg_buy_price ?? 0;
        prev.avg_buy_price = prevBuy + b > 0 ? (prevPrice * prevBuy + price * b) / (prevBuy + b) : price;
      }
      if (s > 0 && Number.isFinite(price)) {
        const prevSell = prev.sell_shares; const prevPrice = prev.avg_sell_price ?? 0;
        prev.avg_sell_price = prevSell + s > 0 ? (prevPrice * prevSell + price * s) / (prevSell + s) : price;
      }
      prev.buy_shares += b; prev.sell_shares += s;
      map.set(id, prev);
    }
  }
  for (const v of map.values()) rows.push(v);
  return rows;
}

// ---- 共用 cookie jar / UA context ----
interface AdaptiveTrigger {
  rule: "escalate_to_standard" | "escalate_to_aggressive" | "reorder_variants" | "exhaustive" | "last_retry_bump";
  from?: string;
  to?: string;
  reason: string; // 通常是 consec>=N 或 attempt=N
}

interface AdaptiveDecision {
  base_mode: OcrResult["mode"];
  effective_mode: OcrResult["mode"];
  variants: OcrVariantName[]; // 實際傳給 OCR 的變體順序
  exhaustive: boolean;
  escalate_on_last: boolean; // 是否會在最後一次 OCR 重試再升級
  consec_before: number;
  triggers: AdaptiveTrigger[];
}

interface OcrTraceEntry {
  retry: number;              // OCR 重試序號（1-based）
  mode: OcrResult["mode"];    // 該次採用的 OCR 模式（可能被 escalate 成 aggressive）
  strategy: OcrResult["strategy"]; // 該模式規劃的變體順序
  variants: OcrResult["attempts"]; // 每個變體的 5 碼結果 + 耗時
  consensus: OcrResult["consensus"]; // majority / fallback_first / none
  adopted: { variant: OcrResult["attempts"][number]["variant"]; text: string; votes: number } | null;
  post_outcome: "accepted" | "empty" | "mismatch"; // 送出後 TWSE 是否接受
  adaptive?: {
    // 每次 retry 實際採用的解析：base/effective mode、變體順序、是否 exhaustive、以及是否被 last_retry_bump 影響
    effective_mode: OcrResult["mode"];
    variants: OcrVariantName[];
    exhaustive: boolean;
    last_retry_bump: boolean;
  };
}

interface SessionCtx {
  jar: Record<string, string>;
  ua: string;
  uaHash: string;
  uaLabel: string;
  acceptLang: string;
  used: number;
  ocrTrace?: OcrTraceEntry[]; // 本次 fetchBsrForStock 的 OCR 軌跡
  adaptive?: AdaptiveDecision; // 本次 fetchBsrForStock 開始時決策的策略
}
function newSession(cfg: SyncConfig): SessionCtx {
  const ua = randomFrom(cfg.ua_pool);
  return {
    jar: {}, ua,
    uaHash: shortHash(ua),
    uaLabel: uaLabelFromString(ua),
    acceptLang: randomFrom(cfg.accept_lang_pool),
    used: 0,
  };
}

/**
 * 純函式：依 consecutive_failures 決定本次 fetch 的 OCR 策略。
 * 呼叫端負責把 decision 寫入 ctx.adaptive 並依 variants/exhaustive/effective_mode 呼叫 OCR。
 */
export function computeAdaptiveStrategy(
  baseMode: OcrResult["mode"],
  consecBefore: number,
  ad: AdaptiveConfig,
): AdaptiveDecision {
  const triggers: AdaptiveTrigger[] = [];
  let effective: OcrResult["mode"] = baseMode;
  let variants: OcrVariantName[] = planWithPriority(effective);
  let exhaustive = false;
  const escalateOnLast = ad.escalate_on_last_retry;

  if (!ad.enabled) {
    return {
      base_mode: baseMode, effective_mode: effective, variants,
      exhaustive, escalate_on_last: escalateOnLast, consec_before: consecBefore,
      triggers,
    };
  }

  if (consecBefore >= ad.escalate_to_standard_at && effective === "fast") {
    triggers.push({ rule: "escalate_to_standard", from: effective, to: "standard", reason: `consec>=${ad.escalate_to_standard_at}` });
    effective = "standard";
  }
  if (consecBefore >= ad.escalate_to_aggressive_at && effective !== "aggressive") {
    triggers.push({ rule: "escalate_to_aggressive", from: effective, to: "aggressive", reason: `consec>=${ad.escalate_to_aggressive_at}` });
    effective = "aggressive";
  }

  variants = planWithPriority(effective);

  if (consecBefore >= ad.reorder_variants_at) {
    // 把預處理較重的變體優先執行，raw 排最後
    const reordered = planWithPriority(effective, ["otsu", "adaptive", "dilate", "loose_crop"]);
    triggers.push({ rule: "reorder_variants", from: variants.join(","), to: reordered.join(","), reason: `consec>=${ad.reorder_variants_at}` });
    variants = reordered;
  }

  if (consecBefore >= ad.exhaustive_at) {
    triggers.push({ rule: "exhaustive", reason: `consec>=${ad.exhaustive_at}` });
    exhaustive = true;
  }

  return {
    base_mode: baseMode, effective_mode: effective, variants,
    exhaustive, escalate_on_last: escalateOnLast, consec_before: consecBefore,
    triggers,
  };
}

// 產生短雜湊（djb2），用來當 UA 的固定 key
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}
// 將 UA 化簡成可讀 label：Browser/OS
function uaLabelFromString(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /Windows NT 10/.test(ua) ? "Win10"
    : /Windows NT 11/.test(ua) ? "Win11"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /Linux/.test(ua) ? "Linux" : "Other";
  const verMatch = ua.match(/(?:Chrome|Firefox|Edg|Version)\/(\d+)/);
  const ver = verMatch ? verMatch[1] : "";
  return `${browser}${ver ? " " + ver : ""} · ${os}`;
}

async function fetchBsrForStock(
  stockId: string,
  ctx: SessionCtx,
  cfg: SyncConfig,
  opts: { consecBefore?: number } = {},
): Promise<BsrRow[]> {
  const baseHeaders = {
    "User-Agent": ctx.ua,
    "Accept-Language": ctx.acceptLang,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  // 1) menu
  const menuResp = await fetch(BSR_MENU, { headers: { ...baseHeaders, Cookie: jarToHeader(ctx.jar) } });
  if (menuResp.status === 403 || menuResp.status === 429) throw new Error(`http_block_${menuResp.status}`);
  const menuHtml = await menuResp.text();
  Object.assign(ctx.jar, parseSetCookie(menuResp.headers));
  const viewState = extractHidden(menuHtml, "__VIEWSTATE");
  const viewStateGen = extractHidden(menuHtml, "__VIEWSTATEGENERATOR");
  const eventValidation = extractHidden(menuHtml, "__EVENTVALIDATION");
  const captchaUrl = extractCaptchaImageUrl(menuHtml);
  if (!viewState || !eventValidation || !captchaUrl) throw new Error("menu_parse_failed");

  // 每一檔開始都重置 OCR 軌跡；並依 consecutive_failures 決定策略
  ctx.ocrTrace = [];
  const consecBefore = Math.max(0, Math.floor(opts.consecBefore || 0));
  const strategy = computeAdaptiveStrategy(cfg.ocr_mode, consecBefore, cfg.adaptive);
  ctx.adaptive = strategy;
  // 細分子原因統計，讓 captcha_retry_exhausted 能拆出 OCR 空值 vs OCR 錯字
  let ocrNullCount = 0;
  let ocrMismatchCount = 0;
  for (let attempt = 1; attempt <= cfg.max_ocr_retry; attempt++) {
    if (attempt > 1) await sleep(jitterPair(cfg.ocr_retry_sleep_ms));
    const capResp = await fetch(captchaUrl, {
      headers: { ...baseHeaders, Cookie: jarToHeader(ctx.jar), Referer: BSR_MENU },
    });
    if (capResp.status === 403 || capResp.status === 429) throw new Error(`http_block_${capResp.status}`);
    if (!capResp.ok) throw new Error(`captcha_http_${capResp.status}`);
    Object.assign(ctx.jar, parseSetCookie(capResp.headers));
    const capBytes = new Uint8Array(await capResp.arrayBuffer());

    // 本次 retry 實際採用的 mode/variants：
    // - 若是最後一次 retry 且 strategy.escalate_on_last，則再往上升一階（standard→aggressive）
    const isLastRetry = attempt === cfg.max_ocr_retry;
    let retryMode: OcrResult["mode"] = strategy.effective_mode;
    let retryVariants: OcrVariantName[] = strategy.variants;
    let lastRetryBump = false;
    if (isLastRetry && strategy.escalate_on_last && retryMode !== "aggressive") {
      const from = retryMode;
      retryMode = retryMode === "fast" ? "standard" : "aggressive";
      // last_retry_bump 也把變體重新以升級後 mode + 重排優先權補齊
      retryVariants = planWithPriority(retryMode,
        consecBefore >= cfg.adaptive.reorder_variants_at ? ["otsu", "adaptive", "dilate", "loose_crop"] : []);
      lastRetryBump = true;
      strategy.triggers.push({ rule: "last_retry_bump", from, to: retryMode, reason: `attempt=${attempt}/${cfg.max_ocr_retry}` });
    }

    const ocr = await ocrTwseCaptchaDetailed(capBytes, {
      mode: retryMode,
      variants: retryVariants,
      exhaustive: strategy.exhaustive,
    });
    const traceEntry: OcrTraceEntry = {
      retry: attempt,
      mode: ocr.mode,
      strategy: ocr.strategy,
      variants: ocr.attempts,
      consensus: ocr.consensus,
      adopted: ocr.text && ocr.winner
        ? { variant: ocr.winner.variant, text: ocr.text, votes: ocr.winner.votes }
        : null,
      post_outcome: "empty",
      adaptive: {
        effective_mode: retryMode,
        variants: retryVariants,
        exhaustive: strategy.exhaustive,
        last_retry_bump: lastRetryBump,
      },
    };
    ctx.ocrTrace.push(traceEntry);
    const captcha = ocr.text;
    if (!captcha) { ocrNullCount++; continue; }

    const form = new URLSearchParams({
      __EVENTTARGET: "", __EVENTARGUMENT: "",
      __VIEWSTATE: viewState, __VIEWSTATEGENERATOR: viewStateGen, __EVENTVALIDATION: eventValidation,
      TxtKeyword: stockId, RadioButton_Normal: "RadioButton_Normal",
      TxtCaptcha: captcha, btnOK: "查詢",
    });
    const postResp = await fetch(BSR_MENU, {
      method: "POST", redirect: "manual",
      headers: {
        ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jarToHeader(ctx.jar), Referer: BSR_MENU, Origin: BSR_HOST,
      },
      body: form.toString(),
    });
    if (postResp.status === 403 || postResp.status === 429) throw new Error(`http_block_${postResp.status}`);
    Object.assign(ctx.jar, parseSetCookie(postResp.headers));

    const loc = postResp.headers.get("location");
    if (postResp.status === 302 && loc && loc.includes("bsContent.aspx")) {
      traceEntry.post_outcome = "accepted";
      const contentUrl = loc.startsWith("http") ? loc : `${BSR_HOST}/bshtm/${loc.replace(/^\.?\//, "")}`;
      const contentResp = await fetch(contentUrl, {
        headers: { ...baseHeaders, Cookie: jarToHeader(ctx.jar), Referer: BSR_MENU },
      });
      if (contentResp.status === 403 || contentResp.status === 429) throw new Error(`http_block_${contentResp.status}`);
      const contentHtml = await contentResp.text();
      return parseBsContent(contentHtml);
    }
    // 有 OCR 結果但未跳轉 bsContent → 判定為 OCR 字元辨識錯誤
    traceEntry.post_outcome = "mismatch";
    ocrMismatchCount++;
  }
  // 附上子細分方便後續 classifyError() 拆桶
  const dominant = ocrMismatchCount >= ocrNullCount ? "ocr_mismatch" : "ocr_null";
  throw new Error(`captcha_retry_exhausted:${dominant}(null=${ocrNullCount},mis=${ocrMismatchCount})`);
}

// 依錯誤訊息拆桶為明確錯誤類別，供失敗看板堆疊圖使用
export function classifyBsrError(msg: string | null | undefined): string {
  const s = String(msg || "");
  if (!s) return "unknown";
  if (/http_block_403/.test(s)) return "http_block_403";
  if (/http_block_429/.test(s)) return "http_block_429";
  if (/http_block/.test(s)) return "http_block";
  if (/captcha_http/.test(s)) return "captcha_http";
  if (/menu_parse_failed/.test(s)) return "menu_parse_failed";
  if (/empty_rows/.test(s)) return "empty_rows";
  if (/db_insert/.test(s)) return "db_insert_failed";
  if (/captcha_retry_exhausted:ocr_mismatch/.test(s)) return "ocr_mismatch";
  if (/captcha_retry_exhausted:ocr_null/.test(s)) return "ocr_null";
  if (/captcha_retry_exhausted/.test(s)) return "captcha_retry_exhausted";
  return "unknown";
}

function rollBackToWeekday(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  while (true) {
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return dt.toISOString().slice(0, 10);
}
function prevWeekday(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  while (true) {
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return dt.toISOString().slice(0, 10);
}

// ---- 分散鎖 ----
async function acquireLock(supa: any, cfg: SyncConfig): Promise<boolean> {
  const now = new Date();
  const expires = new Date(now.getTime() + cfg.lock_ttl_sec * 1000);
  // 先清過期
  await supa.from("tw_bsr_sync_locks").delete().lte("expires_at", now.toISOString());
  const { error } = await supa.from("tw_bsr_sync_locks").insert({
    lock_key: LOCK_KEY, acquired_at: now.toISOString(), expires_at: expires.toISOString(),
  });
  return !error;
}
async function releaseLock(supa: any) {
  await supa.from("tw_bsr_sync_locks").delete().eq("lock_key", LOCK_KEY);
}

// ---- 優先級佇列 ----
async function buildQueue(supa: any, batch: number, offHours: boolean, cfg: SyncConfig): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const todayIso = taipeiTodayISO();

  // A. 已抓到今天資料的股票 → 排除（避免重覆）
  const { data: doneToday } = await supa
    .from("tw_bsr_daily").select("stock_id").eq("trade_date", rollBackToWeekday(todayIso));
  const doneSet = new Set((doneToday || []).map((r: any) => r.stock_id));

  // B. 佇列中「還沒到 next_retry_at」的股票 → 排除
  const { data: waiting } = await supa
    .from("tw_bsr_fetch_failures")
    .select("stock_id, next_retry_at, consecutive_failures")
    .is("resolved_at", null)
    .gt("next_retry_at", nowIso);
  const waitingSet = new Set((waiting || []).map((r: any) => r.stock_id));

  // C. 連續失敗 ≥ cfg.max_consecutive_before_freeze 且 freeze_window_ms 內失敗過 → 冷凍
  const { data: frozen } = await supa
    .from("tw_bsr_fetch_failures")
    .select("stock_id, updated_at, consecutive_failures")
    .is("resolved_at", null)
    .gte("consecutive_failures", cfg.max_consecutive_before_freeze)
    .gte("updated_at", new Date(Date.now() - cfg.freeze_window_ms).toISOString());
  const frozenSet = offHours ? new Set() : new Set((frozen || []).map((r: any) => r.stock_id));


  const skip = (id: string) => doneSet.has(id) || waitingSet.has(id) || frozenSet.has(id);

  // 1) 真人未平倉持倉（trade_records）
  const { data: openTrades } = await supa
    .from("trade_records")
    .select("stock_symbol, close_date")
    .is("close_date", null)
    .limit(2000);
  const priority1 = Array.from(new Set(
    (openTrades || [])
      .map((r: any) => String(r.stock_symbol || "").trim())
      .filter((s: string) => /^[0-9]{4,6}$/.test(s))
  ));

  // 2) 近 7 天有三大法人資料的股票（熱門股 proxy）
  const { data: instRecent } = await supa
    .from("tw_institutional_daily")
    .select("stock_id, total_net")
    .gte("trade_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
    .order("trade_date", { ascending: false })
    .limit(1500);
  const seen = new Set<string>();
  const priority2: string[] = [];
  for (const r of instRecent || []) {
    if (!/^[0-9]{4,6}$/.test(r.stock_id) || seen.has(r.stock_id)) continue;
    seen.add(r.stock_id); priority2.push(r.stock_id);
  }

  // 依優先級去重 + skip
  const out: string[] = [];
  const pushed = new Set<string>();
  for (const src of [priority1, priority2]) {
    for (const id of src) {
      if (pushed.has(id) || skip(id)) continue;
      pushed.add(id); out.push(id);
      if (out.length >= batch) return out;
    }
  }
  return out;
}

// ---- Backfill 佇列：只挑「未 resolved 且 next_retry_at 已到期」的失敗紀錄 ----
// 依「距離最後成功日的日數」與 consecutive_failures 排序，最舊的先補
async function buildBackfillQueue(supa: any, batch: number): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const { data: due } = await supa
    .from("tw_bsr_fetch_failures")
    .select("stock_id, trade_date, consecutive_failures, next_retry_at, updated_at")
    .is("resolved_at", null)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("trade_date", { ascending: true })
    .order("consecutive_failures", { ascending: true })
    .limit(batch * 4);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of due || []) {
    const id = String(r.stock_id);
    if (!/^[0-9]{4,6}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= batch) break;
  }
  return out;
}

// ---- 指標桶（15 分鐘）----
function bucketKey(): string {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15);
  return d.toISOString();
}
async function bumpMetrics(supa: any, patch: { total?: number; success?: number; ocr_fail?: number; http_block?: number; empty?: number; latency_ms?: number }) {
  const key = bucketKey();
  const { data: existing } = await supa.from("tw_bsr_sync_metrics").select("*").eq("bucket_at", key).maybeSingle();
  const total = (existing?.total || 0) + (patch.total || 0);
  const success = (existing?.success || 0) + (patch.success || 0);
  const ocr_fail = (existing?.ocr_fail || 0) + (patch.ocr_fail || 0);
  const http_block = (existing?.http_block || 0) + (patch.http_block || 0);
  const empty = (existing?.empty || 0) + (patch.empty || 0);
  let avg = existing?.avg_latency_ms || 0;
  if (patch.latency_ms && total > 0) {
    const prevSum = (existing?.avg_latency_ms || 0) * (existing?.total || 0);
    avg = Math.round((prevSum + patch.latency_ms) / total);
  }
  await supa.from("tw_bsr_sync_metrics").upsert({
    bucket_at: key, total, success, ocr_fail, http_block, empty, avg_latency_ms: avg,
  }, { onConflict: "bucket_at" });
}

// 從 outcome / error 字串推導 HTTP 狀態碼（success=200；其餘從 http_block_XXX / captcha_http_XXX 解析）
function deriveHttpStatus(outcome: string, err?: string | null): number | null {
  if (outcome === "success") return 200;
  const s = `${outcome} ${err || ""}`;
  const m = s.match(/http[_-]?(?:block|status)?[_-]?(\d{3})|captcha_http_(\d{3})/i);
  if (m) return Number(m[1] || m[2]);
  if (outcome === "empty_rows") return 200;
  return null;
}

// 逐次嘗試日誌：供 UA / backoff / consecutive 效果分析與逐檔時間軸使用。失敗絕不阻斷主流程。
async function logAttempt(supa: any, p: {
  stockId: string; tradeDate: string;
  ctx: SessionCtx; cfg: SyncConfig; configVersion?: string;
  backoffBefore: number; consecBefore: number;
  latencyMs: number; outcome: string; step: number;
  error?: string | null;
  fallbackUsed?: boolean;
  fallbackAsOfDate?: string | null;
  nextRetryAt?: string | null;
  nextRetrySource?: string | null;
  errorClass?: string | null;
}) {
  try {
    const errorClass = p.errorClass
      ?? (p.outcome === "success" ? null : classifyBsrError(p.error || p.outcome));
    await supa.from("tw_bsr_attempt_logs").insert({
      stock_id: p.stockId,
      trade_date: p.tradeDate,
      attempted_at: new Date().toISOString(),
      ua_label: p.ctx.uaLabel,
      ua_hash: p.ctx.uaHash,
      backoff_seconds_before: p.backoffBefore,
      consecutive_failures_before: p.consecBefore,
      ocr_mode: p.cfg.ocr_mode,
      latency_ms: p.latencyMs,
      outcome: p.outcome,
      attempt_step: p.step,
      config_version: p.configVersion || null,
      http_status: deriveHttpStatus(p.outcome, p.error),
      error: p.error || null,
      error_class: errorClass,
      fallback_used: !!p.fallbackUsed,
      fallback_as_of_date: p.fallbackAsOfDate || null,
      next_retry_at: p.nextRetryAt || null,
      next_retry_source: p.nextRetrySource || null,
      ocr_trace: p.ctx.ocrTrace && p.ctx.ocrTrace.length ? p.ctx.ocrTrace : null,
      adaptive_strategy: p.ctx.adaptive ?? null,
    });
  } catch (e) {
    // best-effort：不阻斷主流程，但至少 edge logs 要看得到，避免變成瞎子
    console.error('[tw-bsr-daily-sync] logAttempt insert failed:', (e as Error)?.message || e, {
      stock_id: p.stockId, trade_date: p.tradeDate, outcome: p.outcome, step: p.step,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = String(body?.mode || (Array.isArray(body?.stock_ids) ? "manual" : "queue"));
    const explicit: string[] = Array.isArray(body?.stock_ids) ? body.stock_ids : [];
    const rawDate = String(body?.date || taipeiTodayISO());
    const tradeDate = rollBackToWeekday(rawDate);
    const offHours = String(body?.window || "") === "off_hours";

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { cfg, version: configVersion } = await loadConfig(supa);

    // 動態預設：backfill 模式吃 cfg.backfill；其他模式維持既有硬預設但仍受 cfg 上限保護
    const isBackfill = mode === "backfill";
    const defaultBatch = isBackfill ? cfg.backfill.batch : 8;
    const defaultLookback = isBackfill ? cfg.backfill.lookback : 5;
    const batchMax = Math.max(1, cfg.backfill.batch_max);
    const lookbackMax = Math.max(1, cfg.backfill.lookback_max);
    const batch = Math.min(Math.max(Number(body?.batch) || defaultBatch, 1), batchMax);
    const lookback = Math.min(Math.max(Number(body?.lookback) || defaultLookback, 1), lookbackMax);

    // 高頻週期上限：僅對 backfill 模式生效；0 = 不限
    if (isBackfill && cfg.backfill.max_runs_per_hour > 0) {
      const sinceIso = new Date(Date.now() - 3600_000).toISOString();
      const { count: recentRuns } = await supa
        .from("system_jobs_log")
        .select("id", { count: "exact", head: true })
        .eq("job_name", "tw-bsr-backfill")
        .gte("ran_at", sinceIso);
      if ((recentRuns || 0) >= cfg.backfill.max_runs_per_hour) {
        return jsonResponse({
          skipped: "rate_limited",
          reason: "high_frequency_cap_reached",
          window: "1h",
          runs_in_window: recentRuns,
          max_runs_per_hour: cfg.backfill.max_runs_per_hour,
          config_version: configVersion,
        });
      }
    }

    // ---- AUDIT MODE：唯讀，不 fetch、不寫、不搶 lock ----
    if (mode === "audit") {
      const ids = (Array.isArray(body?.stock_ids) ? body.stock_ids : [])
        .map((s: any) => String(s || "").trim())
        .filter((s: string) => /^[0-9]{4,6}$/.test(s));
      if (ids.length === 0) return errorResponse("stock_ids required", 400, { code: "BAD_INPUT" });

      const auditResults = await Promise.all(ids.map(async (stockId) => {
        // 1) lookback chain：從 tradeDate 往回 lookback 個工作日
        const chainDates: string[] = [];
        let cur = tradeDate;
        for (let i = 0; i < lookback; i++) {
          if (i > 0) cur = prevWeekday(cur);
          chainDates.push(cur);
        }
        const chainCounts = await Promise.all(chainDates.map(async (d) => {
          const { count } = await supa
            .from("tw_bsr_daily")
            .select("broker_id", { count: "exact", head: true })
            .eq("stock_id", stockId).eq("trade_date", d);
          return { date: d, rows: count || 0 };
        }));

        // 2) last_successful：≤ tradeDate 的最近成功日
        const { data: lastOk } = await supa
          .from("tw_bsr_daily").select("trade_date")
          .eq("stock_id", stockId).lte("trade_date", tradeDate)
          .order("trade_date", { ascending: false }).limit(1);
        const lastAsOf = lastOk?.[0]?.trade_date as string | undefined;
        let lastSuccessful: any = null;
        if (lastAsOf) {
          const { count } = await supa.from("tw_bsr_daily")
            .select("broker_id", { count: "exact", head: true })
            .eq("stock_id", stockId).eq("trade_date", lastAsOf);
          lastSuccessful = {
            as_of_date: lastAsOf,
            rows: count || 0,
            lag_days: Math.max(0, Math.round(
              (new Date(tradeDate).getTime() - new Date(lastAsOf).getTime()) / 86400000
            )),
          };
        }

        // 3) rollup 三窗
        const { data: rollupRows } = await supa
          .from("tw_chips_rollup")
          .select("window_days, as_of_date")
          .eq("stock_id", stockId)
          .order("as_of_date", { ascending: false });
        const rollup: Record<string, string | null> = { "5": null, "20": null, "60": null };
        for (const w of [5, 20, 60] as const) {
          const hit = (rollupRows || []).find((r: any) => r.window_days === w);
          if (hit) rollup[String(w)] = hit.as_of_date;
        }

        // 4) failure state
        const { data: failRows } = await supa
          .from("tw_bsr_fetch_failures")
          .select("trade_date, reason, attempts, consecutive_failures, backoff_seconds, next_retry_at, resolved_at, last_error, updated_at")
          .eq("stock_id", stockId)
          .order("updated_at", { ascending: false })
          .limit(10);
        const unresolved = (failRows || []).find((r: any) => !r.resolved_at) || null;

        // 5) 對齊判定：以 5-day rollup 為代表
        const rollupPrimary = rollup["5"];
        let aligned = false;
        let mismatchReason: string | null = null;
        if (!lastSuccessful && !rollupPrimary) {
          mismatchReason = "no_data";
        } else if (!rollupPrimary && lastSuccessful) {
          mismatchReason = "rollup_missing";
        } else if (rollupPrimary && !lastSuccessful) {
          mismatchReason = "rollup_ahead";
        } else if (rollupPrimary! < lastSuccessful.as_of_date) {
          mismatchReason = "rollup_stale";
        } else if (rollupPrimary! > lastSuccessful.as_of_date) {
          mismatchReason = "rollup_ahead";
        } else {
          aligned = true;
        }

        return {
          stock_id: stockId,
          attempted_as_of_date: tradeDate,
          lookback_chain: chainCounts,
          last_successful: lastSuccessful,
          rollup,
          failure_state: {
            unresolved,
            recent: failRows || [],
          },
          aligned,
          mismatch_reason: mismatchReason,
        };
      }));

      return jsonResponse({
        mode: "audit",
        date: tradeDate,
        lookback,
        results: auditResults,
        generated_at: new Date().toISOString(),
      });
    }

    const gotLock = await acquireLock(supa, cfg);
    if (!gotLock) return jsonResponse({ skipped: "lock_held", config_version: configVersion });

    try {
      // 決定股票清單
      let stocks: string[] = explicit.filter((s) => /^[0-9]{4,6}$/.test(s));
      if (mode === "backfill" && stocks.length === 0) {
        // Backfill 模式：只挑已到期的失敗，忽略 off-hours 凍結，允許較深 lookback
        stocks = await buildBackfillQueue(supa, batch);
      } else if (mode !== "manual" || stocks.length === 0) {
        stocks = await buildQueue(supa, batch, offHours, cfg);
      } else {
        stocks = stocks.slice(0, batch);
      }

      const results: any[] = [];
      let ctx = newSession(cfg);

      for (const stockId of stocks) {
        // cookie jar 輪替
        if (ctx.used >= cfg.cookie_jar_reuse) ctx = newSession(cfg);
        ctx.used++;

        const attempts: Array<{ date: string; error: string }> = [];
        let resolvedDate: string | null = null;
        let resolvedRows = 0;
        let lastError = "";
        let ocrFailBump = 0, blockBump = 0, emptyBump = 0;

        // 讀取本檔嘗試前的 backoff / consecutive 狀態（用於效果分析歸類）
        const { data: preState } = await supa.from("tw_bsr_fetch_failures")
          .select("consecutive_failures, backoff_seconds")
          .eq("stock_id", stockId).eq("trade_date", tradeDate).maybeSingle();
        const consecBefore = Number(preState?.consecutive_failures || 0);
        const backoffBefore = Number(preState?.backoff_seconds || 0);

        let cursor = tradeDate;
        const startedAt = Date.now();

        for (let step = 0; step < lookback; step++) {
          if (step > 0) cursor = prevWeekday(cursor);

          const { count: existCount } = await supa
            .from("tw_bsr_daily")
            .select("broker_id", { count: "exact", head: true })
            .eq("stock_id", stockId).eq("trade_date", cursor);
          if ((existCount || 0) > 0) {
            resolvedDate = cursor; resolvedRows = existCount || 0;
            await rebuildRollup(supa, stockId, cursor);
            break;
          }

          const stepStartedAt = Date.now();
          let stepOutcome = "success";
          try {
            const rows = await fetchBsrForStock(stockId, ctx, cfg, { consecBefore });
            if (rows.length === 0) throw new Error("empty_rows");

            // P4: 寫入 tw_chip_fact（append-only, source='broker_scraper'）→ 觸發 materializer。
            const nowIso = new Date().toISOString();
            const factPayload = rows.map((r) => ({
              stock_id: stockId, trade_date: cursor,
              broker_id: r.broker_id, broker_name: r.broker_name,
              source: 'broker_scraper',
              buy_shares: r.buy_shares, sell_shares: r.sell_shares,
              net_shares: r.buy_shares - r.sell_shares,
              avg_buy_price: r.avg_buy_price, avg_sell_price: r.avg_sell_price,
              ingested_at: nowIso,
            }));
            const { error: insErr } = await supa.from("tw_chip_fact")
              .upsert(factPayload, { onConflict: "stock_id,trade_date,broker_id,source" });
            if (insErr) throw new Error(`db_insert:${insErr.message}`);
            const { error: matErr } = await supa.rpc('materialize_bsr_daily_from_fact', {
              _trade_date: cursor,
            });
            if (matErr) throw new Error(`materialize_failed:${matErr.message}`);

            await rebuildRollup(supa, stockId, cursor);

            // 清 backoff：整個 stock 的未 resolved 失敗全部清掉
            await supa.from("tw_bsr_fetch_failures").update({
              resolved_at: new Date().toISOString(),
              consecutive_failures: 0,
              backoff_seconds: 60,
              next_retry_at: null,
            }).eq("stock_id", stockId).is("resolved_at", null);

            resolvedDate = cursor; resolvedRows = rows.length;
            // 記錄效果分析
            await logAttempt(supa, {
              stockId, tradeDate: cursor, ctx, cfg, configVersion,
              backoffBefore, consecBefore, latencyMs: Date.now() - stepStartedAt,
              outcome: "success", step,
            });
            break;
          } catch (err) {
            const msg = (err as Error).message || "unknown";
            const isBlock = /http_block/.test(msg);
            const isOcr = /captcha_retry_exhausted|captcha_http/.test(msg);
            const isEmpty = /empty_rows/.test(msg);
            const reason = isBlock ? "http_block"
              : isOcr ? "captcha_retry_exhausted"
              : isEmpty ? "empty_rows"
              : /menu_parse_failed/.test(msg) ? "menu_parse_failed" : "sync_failed";
            if (isBlock) blockBump++;
            else if (isOcr) ocrFailBump++;
            else if (isEmpty) emptyBump++;
            attempts.push({ date: cursor, error: msg });
            lastError = msg;
            stepOutcome = reason;

            await logAttempt(supa, {
              stockId, tradeDate: cursor, ctx, cfg, configVersion,
              backoffBefore, consecBefore, latencyMs: Date.now() - stepStartedAt,
              outcome: stepOutcome, step, error: msg,
              errorClass: classifyBsrError(msg),
            });

            // 被擋直接中止本檔的 lookback（避免對同 IP 再擊）
            if (isBlock) break;
          }
        }

        const latencyMs = Date.now() - startedAt;

        if (resolvedDate) {
          results.push({
            stock_id: stockId, ok: true, rows: resolvedRows, resolved_date: resolvedDate,
            fallback: null, attempts, consec_before: consecBefore,
            resolved_at_updated: consecBefore > 0, mismatch_reason: null,
          });
          await bumpMetrics(supa, { total: 1, success: 1, latency_ms: latencyMs });

        } else {
          // 寫/更新失敗紀錄（單一 row per stock，target_date = 起始日）
          const { data: prevFail } = await supa.from("tw_bsr_fetch_failures")
            .select("consecutive_failures, backoff_seconds")
            .eq("stock_id", stockId).eq("trade_date", tradeDate).maybeSingle();
          const nextConsec = (prevFail?.consecutive_failures || 0) + 1;
          const backoffIdx = Math.min(nextConsec - 1, cfg.backoff_steps_sec.length - 1);
          const stepBackoff = cfg.backoff_steps_sec[backoffIdx];
          // 冷卻保護：同一 stock+trade_date 累積失敗達 max_attempts_per_day → 強制延後 cooldown_hours
          const cooldownSec = cfg.backfill.cooldown_hours * 3600;
          const cooldownTriggered = nextConsec >= cfg.backfill.max_attempts_per_day;
          const backoff = cooldownTriggered ? Math.max(stepBackoff, cooldownSec) : stepBackoff;
          const nextRetry = new Date(Date.now() + backoff * 1000).toISOString();
          const baseReason = blockBump ? "http_block"
            : ocrFailBump ? "captcha_retry_exhausted"
            : emptyBump ? "empty_rows" : "sync_failed";
          const reason = cooldownTriggered ? `cooldown:${baseReason}` : baseReason;
          const errorClass = classifyBsrError(lastError || baseReason);
          await supa.from("tw_bsr_fetch_failures").upsert({
            stock_id: stockId, trade_date: tradeDate,
            reason, error_class: errorClass,
            attempts: attempts.length, last_error: lastError,
            consecutive_failures: nextConsec, backoff_seconds: backoff,
            next_retry_at: nextRetry, updated_at: new Date().toISOString(),
          }, { onConflict: "stock_id,trade_date" });

          // Fallback：拿最近一次成功日補顯示
          const { data: lastOk } = await supa.from("tw_bsr_daily").select("trade_date")
            .eq("stock_id", stockId).lte("trade_date", tradeDate)
            .order("trade_date", { ascending: false }).limit(1);
          const fallbackDate = lastOk?.[0]?.trade_date as string | undefined;
          let fallback: any = null;
          if (fallbackDate) {
            const { count: fbCount } = await supa.from("tw_bsr_daily")
              .select("broker_id", { count: "exact", head: true })
              .eq("stock_id", stockId).eq("trade_date", fallbackDate);
            await rebuildRollup(supa, stockId, fallbackDate);
            fallback = {
              source: "last_successful", as_of_date: fallbackDate, rows: fbCount || 0,
              lag_days: Math.max(0, Math.round((new Date(tradeDate).getTime() - new Date(fallbackDate).getTime()) / 86400000)),
            };
          }
          const nextRetrySource = cooldownTriggered
            ? `cooldown[${nextConsec}/${cfg.backfill.max_attempts_per_day}]=${cfg.backfill.cooldown_hours}h`
              + ` (reason=${baseReason},step_backoff=${stepBackoff}s)`
            : `backoff_step[${Math.min(nextConsec, cfg.backoff_steps_sec.length)}/${cfg.backoff_steps_sec.length}]=${backoff}s`
              + ` (reason=${baseReason},consec=${nextConsec})`;

          // 逐檔時間軸「收尾」列：紀錄本輪最終狀態 + fallback + next_retry 推算來源
          await logAttempt(supa, {
            stockId, tradeDate,
            ctx, cfg, configVersion,
            backoffBefore, consecBefore,
            latencyMs, outcome: `finalized:${reason}`, step: 99,
            error: lastError || null,
            fallbackUsed: !!fallbackDate,
            fallbackAsOfDate: fallbackDate || null,
            nextRetryAt: nextRetry,
            nextRetrySource,
          });

          results.push({
            stock_id: stockId, ok: false, error: lastError || "no_data",
            attempts, fallback, next_retry_at: nextRetry, backoff_seconds: backoff,
            next_retry_source: nextRetrySource, consec_before: consecBefore,
            mismatch_reason: errorClass, final_reason: reason, resolved_at_updated: false,
            cooldown_triggered: cooldownTriggered,
            cooldown_until: cooldownTriggered ? nextRetry : null,
            attempts_total: nextConsec,
            max_attempts_per_day: cfg.backfill.max_attempts_per_day,
          });


          await bumpMetrics(supa, {
            total: 1, ocr_fail: ocrFailBump ? 1 : 0, http_block: blockBump ? 1 : 0,
            empty: emptyBump ? 1 : 0, latency_ms: latencyMs,
          });

          // 被擋就整輪中止，讓下一輪 cron 接手
          if (blockBump) {
            results.push({ aborted: "http_block" });
            break;
          }
        }

        // 每檔之間節流
        await sleep(jitterPair(cfg.per_stock_sleep_ms));
      }

      const successCount = results.filter((r) => r.ok).length;
      const failedCount = results.filter((r) => r.ok === false).length;
      // 本輪成功恢復 last_successful 的股票（先前 consecutive_failures>0，本輪 ok）
      const recovered = results.filter((r) => r.ok && Number(r.consec_before || 0) > 0);
      // 本輪觸發資料冷卻（達 max_attempts_per_day）的股票
      const cooledDown = results.filter((r) => r.ok === false && r.cooldown_triggered);
      // 本輪回補覆蓋的 fallback / resolved 日期範圍
      const coveredDates: string[] = [];
      for (const r of results) {
        if (r.ok && r.resolved_date) coveredDates.push(r.resolved_date);
        if (!r.ok && r.fallback?.as_of_date) coveredDates.push(r.fallback.as_of_date);
      }
      const sortedDates = coveredDates.filter(Boolean).sort();
      const fallbackRange = sortedDates.length
        ? { min: sortedDates[0], max: sortedDates[sortedDates.length - 1] }
        : null;


      // 逐檔嘗試視窗（lookback_from ~ lookback_to），從 tradeDate 往回推 (lookback-1) 個交易日
      let lookbackFrom = tradeDate;
      for (let i = 1; i < lookback; i++) lookbackFrom = prevWeekday(lookbackFrom);
      const lookbackWindow = { from: lookbackFrom, to: tradeDate };

      // 每檔明細（供 Backfill 進度頁展開查看）
      const perStock = results
        .filter((r) => r.stock_id)
        .map((r) => ({
          stock_id: r.stock_id,
          ok: !!r.ok,
          resolved_date: r.resolved_date || null,
          resolved_at_updated: !!r.resolved_at_updated,
          mismatch_reason: r.mismatch_reason || null,
          final_reason: r.final_reason || (r.ok ? "success" : "sync_failed"),
          attempts: (r.attempts || []).map((a: any) => ({
            date: a.date, error: a.error, error_class: classifyBsrError(a.error),
          })),
          attempts_count: (r.attempts || []).length,
          attempts_total: Number(r.attempts_total || 0),
          fallback: r.fallback || null,
          next_retry_at: r.next_retry_at || null,
          next_retry_source: r.next_retry_source || null,
          consec_before: Number(r.consec_before || 0),
          cooldown_triggered: !!r.cooldown_triggered,
          cooldown_until: r.cooldown_until || null,
          max_attempts_per_day: r.max_attempts_per_day || null,
          lookback_from: lookbackFrom,
          lookback_to: tradeDate,
        }));


      // 為 backfill 進度看板寫入摘要（其它 mode 也留紀錄，方便對照）
      try {
        await supa.from("system_jobs_log").insert({
          job_name: `tw-bsr-${mode}`,
          status: failedCount === 0 ? "success" : (successCount > 0 ? "partial" : "failed"),
          detail: {
            mode,
            date: tradeDate,
            lookback,
            lookback_window: lookbackWindow,
            batch,
            processed: stocks.length,
            success: successCount,
            failed: failedCount,
            recovered_last_successful_count: recovered.length,
            recovered_stocks: recovered.map((r) => ({
              stock_id: r.stock_id,
              resolved_date: r.resolved_date,
              consec_before: r.consec_before,
            })),
            fallback_range: fallbackRange,
            covered_dates: Array.from(new Set(sortedDates)),
            config_version: configVersion,
            cooldown_triggered_count: cooledDown.length,
            cooldown_stocks: cooledDown.map((r) => ({
              stock_id: r.stock_id,
              attempts_total: r.attempts_total,
              cooldown_until: r.cooldown_until,
              reason: r.final_reason,
            })),
            cooldown_policy: {
              max_attempts_per_day: cfg.backfill.max_attempts_per_day,
              cooldown_hours: cfg.backfill.cooldown_hours,
            },
            per_stock: perStock,
          },
        });
      } catch (_e) { /* log-only, 不影響回傳 */ }


      return jsonResponse({
        mode, date: tradeDate, lookback, batch,
        processed: stocks.length,
        success: successCount,
        failed: failedCount,
        recovered_last_successful_count: recovered.length,
        cooldown_triggered_count: cooledDown.length,
        cooldown_policy: {
          max_attempts_per_day: cfg.backfill.max_attempts_per_day,
          cooldown_hours: cfg.backfill.cooldown_hours,
        },
        fallback_range: fallbackRange,
        config_version: configVersion,
        results,
      });

    } finally {
      await releaseLock(supa);
    }
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});

// ---- rollup helper ----
async function rebuildRollup(supa: any, stockId: string, asOf: string) {
  const since = new Date(asOf);
  since.setDate(since.getDate() - 90);
  const { data: bsrRows } = await supa
    .from("tw_bsr_daily")
    .select("trade_date, broker_id, broker_name, net_shares, buy_shares, sell_shares")
    .eq("stock_id", stockId)
    .gte("trade_date", since.toISOString().slice(0, 10))
    .lte("trade_date", asOf)
    .order("trade_date", { ascending: false });

  const uniqueDates = Array.from(new Set((bsrRows || []).map((r: any) => r.trade_date))).sort((a, b) => (a < b ? 1 : -1));

  // 當日 broker count 供 chips-detail 序列讀取（寫在 window_days=5 那列）。
  const todayBrokers = new Set(
    (bsrRows || []).filter((r: any) => r.trade_date === asOf).map((r: any) => r.broker_id),
  );
  const todayBrokerCount = todayBrokers.size;

  for (const win of [5, 20, 60] as const) {
    const dates = new Set(uniqueDates.slice(0, win));
    const slice = (bsrRows || []).filter((r: any) => dates.has(r.trade_date));
    if (slice.length === 0) continue;

    const agg = new Map<string, { name: string; net: number; buy: number; sell: number }>();
    for (const r of slice) {
      const cur = agg.get(r.broker_id) || { name: r.broker_name, net: 0, buy: 0, sell: 0 };
      cur.net += Number(r.net_shares || 0);
      cur.buy += Number(r.buy_shares || 0);
      cur.sell += Number(r.sell_shares || 0);
      agg.set(r.broker_id, cur);
    }
    const list = Array.from(agg.entries()).map(([broker_id, v]) => ({
      broker_id, name: v.name, net: v.net, buy: v.buy, sell: v.sell,
    }));
    const topBuy = [...list].sort((a, b) => b.net - a.net).slice(0, 3).map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
    const topSell = [...list].sort((a, b) => a.net - b.net).slice(0, 3).map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
    const totalBuy = list.reduce((s, b) => s + b.buy, 0);
    const top15Buy = [...list].sort((a, b) => b.buy - a.buy).slice(0, 15).reduce((s, b) => s + b.buy, 0);
    const concentration = totalBuy > 0 ? (top15Buy / totalBuy) * 100 : null;

    const row: any = {
      stock_id: stockId, as_of_date: asOf, window_days: win,
      foreign_net: 0, trust_net: 0, dealer_net: 0,
      top_buy_brokers: topBuy, top_sell_brokers: topSell,
      concentration_ratio: concentration, bsr_available: true,
      updated_at: new Date().toISOString(),
    };
    if (win === 5) {
      row.broker_count = todayBrokerCount;
      row.low_quality = todayBrokerCount > 0 && todayBrokerCount < 5;
    }
    await supa.from("tw_chips_rollup").upsert(row, { onConflict: "stock_id,as_of_date,window_days" });
  }
}
