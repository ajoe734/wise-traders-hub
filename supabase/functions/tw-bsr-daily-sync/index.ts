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
import { ocrTwseCaptcha } from "../_shared/twOcr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BSR_HOST = "https://bsr.twse.com.tw";
const BSR_MENU = `${BSR_HOST}/bshtm/bsMenu.aspx`;
const LOCK_KEY = "tw-bsr-daily-sync";

// ---- 動態設定：tw_bsr_sync_config（key='bsr_sync'）→ 可熱調且有版本歷史 ----
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
}

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
};

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
interface SessionCtx {
  jar: Record<string, string>;
  ua: string;
  acceptLang: string;
  used: number;
}
function newSession(cfg: SyncConfig): SessionCtx {
  return { jar: {}, ua: randomFrom(cfg.ua_pool), acceptLang: randomFrom(cfg.accept_lang_pool), used: 0 };
}

async function fetchBsrForStock(stockId: string, ctx: SessionCtx, cfg: SyncConfig): Promise<BsrRow[]> {
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

  for (let attempt = 1; attempt <= cfg.max_ocr_retry; attempt++) {
    if (attempt > 1) await sleep(jitterPair(cfg.ocr_retry_sleep_ms));
    const capResp = await fetch(captchaUrl, {
      headers: { ...baseHeaders, Cookie: jarToHeader(ctx.jar), Referer: BSR_MENU },
    });
    if (capResp.status === 403 || capResp.status === 429) throw new Error(`http_block_${capResp.status}`);
    if (!capResp.ok) throw new Error(`captcha_http_${capResp.status}`);
    Object.assign(ctx.jar, parseSetCookie(capResp.headers));
    const capBytes = new Uint8Array(await capResp.arrayBuffer());
    // 動態升級：最後一次重試時，若允許升級且不是 aggressive，改用 aggressive 加大成功率
    const activeMode = cfg.ocr_escalate_on_fail && attempt === cfg.max_ocr_retry && cfg.ocr_mode !== "aggressive"
      ? "aggressive" : cfg.ocr_mode;
    const captcha = await ocrTwseCaptcha(capBytes, activeMode);
    if (!captcha) continue;

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
      const contentUrl = loc.startsWith("http") ? loc : `${BSR_HOST}/bshtm/${loc.replace(/^\.?\//, "")}`;
      const contentResp = await fetch(contentUrl, {
        headers: { ...baseHeaders, Cookie: jarToHeader(ctx.jar), Referer: BSR_MENU },
      });
      if (contentResp.status === 403 || contentResp.status === 429) throw new Error(`http_block_${contentResp.status}`);
      const contentHtml = await contentResp.text();
      return parseBsContent(contentHtml);
    }
  }
  throw new Error("captcha_retry_exhausted");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = String(body?.mode || (Array.isArray(body?.stock_ids) ? "manual" : "queue"));
    const explicit: string[] = Array.isArray(body?.stock_ids) ? body.stock_ids : [];
    const batch = Math.min(Math.max(Number(body?.batch) || 8, 1), 20);
    const rawDate = String(body?.date || taipeiTodayISO());
    const tradeDate = rollBackToWeekday(rawDate);
    const lookback = Math.min(Math.max(Number(body?.lookback) || 5, 1), 7);
    const offHours = String(body?.window || "") === "off_hours";

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { cfg, version: configVersion } = await loadConfig(supa);

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

          try {
            const rows = await fetchBsrForStock(stockId, ctx, cfg);
            if (rows.length === 0) throw new Error("empty_rows");

            await supa.from("tw_bsr_daily").delete().eq("stock_id", stockId).eq("trade_date", cursor);
            const payload = rows.map((r) => ({
              stock_id: stockId, trade_date: cursor,
              broker_id: r.broker_id, broker_name: r.broker_name,
              buy_shares: r.buy_shares, sell_shares: r.sell_shares,
              net_shares: r.buy_shares - r.sell_shares,
              avg_buy_price: r.avg_buy_price, avg_sell_price: r.avg_sell_price,
            }));
            const { error: insErr } = await supa.from("tw_bsr_daily").insert(payload);
            if (insErr) throw new Error(`db_insert:${insErr.message}`);

            await rebuildRollup(supa, stockId, cursor);

            // 清 backoff：整個 stock 的未 resolved 失敗全部清掉
            await supa.from("tw_bsr_fetch_failures").update({
              resolved_at: new Date().toISOString(),
              consecutive_failures: 0,
              backoff_seconds: 60,
              next_retry_at: null,
            }).eq("stock_id", stockId).is("resolved_at", null);

            resolvedDate = cursor; resolvedRows = rows.length;
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

            // 被擋直接中止本檔的 lookback（避免對同 IP 再擊）
            if (isBlock) break;
          }
        }

        const latencyMs = Date.now() - startedAt;

        if (resolvedDate) {
          results.push({ stock_id: stockId, ok: true, rows: resolvedRows, resolved_date: resolvedDate, fallback: null, attempts });
          await bumpMetrics(supa, { total: 1, success: 1, latency_ms: latencyMs });
        } else {
          // 寫/更新失敗紀錄（單一 row per stock，target_date = 起始日）
          const { data: prevFail } = await supa.from("tw_bsr_fetch_failures")
            .select("consecutive_failures, backoff_seconds")
            .eq("stock_id", stockId).eq("trade_date", tradeDate).maybeSingle();
          const nextConsec = (prevFail?.consecutive_failures || 0) + 1;
          const backoffIdx = Math.min(nextConsec - 1, cfg.backoff_steps_sec.length - 1);
          const backoff = cfg.backoff_steps_sec[backoffIdx];
          const nextRetry = new Date(Date.now() + backoff * 1000).toISOString();
          const reason = blockBump ? "http_block"
            : ocrFailBump ? "captcha_retry_exhausted"
            : emptyBump ? "empty_rows" : "sync_failed";
          await supa.from("tw_bsr_fetch_failures").upsert({
            stock_id: stockId, trade_date: tradeDate,
            reason, attempts: attempts.length, last_error: lastError,
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
          results.push({
            stock_id: stockId, ok: false, error: lastError || "no_data",
            attempts, fallback, next_retry_at: nextRetry, backoff_seconds: backoff,
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

      return jsonResponse({
        mode, date: tradeDate, lookback, batch,
        processed: stocks.length,
        success: results.filter((r) => r.ok).length,
        failed: results.filter((r) => r.ok === false).length,
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

    await supa.from("tw_chips_rollup").upsert({
      stock_id: stockId, as_of_date: asOf, window_days: win,
      foreign_net: 0, trust_net: 0, dealer_net: 0,
      top_buy_brokers: topBuy, top_sell_brokers: topSell,
      concentration_ratio: concentration, bsr_available: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stock_id,as_of_date,window_days" });
  }
}
