// deno-lint-ignore-file no-explicit-any
// tw-bsr-daily-sync
// 目標：抓 TWSE BSR（分點買賣超）→ 落地 tw_bsr_daily → 重算 tw_chips_rollup（5/20/60 日）
//
// 呼叫方式：
//   POST /tw-bsr-daily-sync                      → 自動挑近 7 日曾出現在 tw_institutional_daily 的 stock_id，
//                                                   最多處理 { limit: 20 } 檔
//   POST /tw-bsr-daily-sync { stock_ids: [...] } → 指定股票（優先於自動挑選）
//   POST /tw-bsr-daily-sync { stock_ids, date }  → 指定交易日（YYYY-MM-DD）
//
// TWSE BSR 流程：
//   1. GET bsMenu.aspx → 拿 __VIEWSTATE / __EVENTVALIDATION / Cookie / CaptchaImage URL
//   2. GET CaptchaImage.aspx?guid=... → PNG，餵 Lovable AI Vision OCR
//   3. POST bsMenu.aspx (form) with StockNo + CaptchaControl1=<ocr> → 回應含 bsContent.aspx?StockNo=... 導向
//   4. GET bsContent.aspx?StockNo=... → 解析 HTML table
//   OCR 失敗最多重試 3 次；仍失敗寫 tw_bsr_fetch_failures。
//
// 一檔股票同時包含買方分點、賣方分點；BSR 提供的是「當日累計」，我們每檔會把當天所有列 upsert 進 tw_bsr_daily。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ocrTwseCaptcha } from "../_shared/twOcr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BSR_HOST = "https://bsr.twse.com.tw";
const BSR_MENU = `${BSR_HOST}/bshtm/bsMenu.aspx`;
const BSR_CONTENT = `${BSR_HOST}/bshtm/bsContent.aspx`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MAX_OCR_RETRY = 3;

function taipeiTodayISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

// ----- Cookie jar (簡化：只保留 name=value) -----
function parseSetCookie(headers: Headers): Record<string, string> {
  const jar: Record<string, string> = {};
  // Deno Headers: getSetCookie() 若可用；退回 raw
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

// ----- HTML 抓取 __VIEWSTATE / __EVENTVALIDATION / captcha URL -----
function extractHidden(html: string, name: string): string {
  const re = new RegExp(`<input[^>]+name="${name}"[^>]+value="([^"]*)"`, "i");
  return html.match(re)?.[1] || "";
}

function extractCaptchaImageUrl(html: string): string | null {
  // <img ... src="CaptchaImage.aspx?guid=..." ...>
  const m = html.match(/CaptchaImage\.aspx\?[^"'\s>]+/i);
  return m ? `${BSR_HOST}/bshtm/${m[0]}` : null;
}

// ----- 解析 bsContent 表格 -----
interface BsrRow {
  broker_id: string;
  broker_name: string;
  buy_shares: number;
  sell_shares: number;
  avg_buy_price: number | null;
  avg_sell_price: number | null;
}

function parseBsContent(html: string): BsrRow[] {
  // BSR 頁面有兩張並排表：左=買超、右=賣超；每列格式：
  //  <td>券商代號</td><td>券商名稱</td><td>價格</td><td>買進股數</td><td>賣出股數</td>
  // 我們用行拆解：把所有 <tr>...</tr> 抓出來、然後 stripHtml 後按空白切欄
  const rows: BsrRow[] = [];
  const map = new Map<string, BsrRow>(); // key = broker_id
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const inner = m[1];
    const tds = Array.from(inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) =>
      x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(),
    );
    if (tds.length < 5) continue;
    // 一列可能同時含 買方 5 欄 + 賣方 5 欄（共 10）；亦可能只有 5 欄
    for (let i = 0; i + 4 < tds.length; i += 5) {
      const id = tds[i];
      const name = tds[i + 1];
      const price = Number(tds[i + 2].replace(/,/g, ""));
      const buy = Number(tds[i + 3].replace(/,/g, ""));
      const sell = Number(tds[i + 4].replace(/,/g, ""));
      if (!id || !/^[0-9a-zA-Z]{3,6}$/.test(id)) continue;
      if (Number.isNaN(buy) && Number.isNaN(sell)) continue;
      const prev = map.get(id) || {
        broker_id: id,
        broker_name: name,
        buy_shares: 0,
        sell_shares: 0,
        avg_buy_price: null as number | null,
        avg_sell_price: null as number | null,
      };
      const b = Number.isFinite(buy) ? buy : 0;
      const s = Number.isFinite(sell) ? sell : 0;
      // 加權均價
      if (b > 0 && Number.isFinite(price)) {
        const prevBuy = prev.buy_shares;
        const prevPrice = prev.avg_buy_price ?? 0;
        prev.avg_buy_price = prevBuy + b > 0 ? (prevPrice * prevBuy + price * b) / (prevBuy + b) : price;
      }
      if (s > 0 && Number.isFinite(price)) {
        const prevSell = prev.sell_shares;
        const prevPrice = prev.avg_sell_price ?? 0;
        prev.avg_sell_price = prevSell + s > 0 ? (prevPrice * prevSell + price * s) / (prevSell + s) : price;
      }
      prev.buy_shares += b;
      prev.sell_shares += s;
      map.set(id, prev);
    }
  }
  for (const v of map.values()) rows.push(v);
  return rows;
}

// ----- 單檔股票流程 -----
async function fetchBsrForStock(stockId: string): Promise<BsrRow[]> {
  // 1) menu
  const menuResp = await fetch(BSR_MENU, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  const menuHtml = await menuResp.text();
  const jar = parseSetCookie(menuResp.headers);
  const viewState = extractHidden(menuHtml, "__VIEWSTATE");
  const viewStateGen = extractHidden(menuHtml, "__VIEWSTATEGENERATOR");
  const eventValidation = extractHidden(menuHtml, "__EVENTVALIDATION");
  const captchaUrl = extractCaptchaImageUrl(menuHtml);
  if (!viewState || !eventValidation || !captchaUrl) {
    throw new Error("menu_parse_failed");
  }

  for (let attempt = 1; attempt <= MAX_OCR_RETRY; attempt++) {
    // 2) captcha
    const capResp = await fetch(captchaUrl, {
      headers: { "User-Agent": UA, Cookie: jarToHeader(jar), Referer: BSR_MENU },
    });
    if (!capResp.ok) throw new Error(`captcha_http_${capResp.status}`);
    // 更新 cookie（session id 首次可能才發）
    Object.assign(jar, parseSetCookie(capResp.headers));
    const capBytes = new Uint8Array(await capResp.arrayBuffer());
    const captcha = await ocrTwseCaptcha(capBytes);
    if (!captcha) continue;

    // 3) POST menu
    const form = new URLSearchParams({
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      __EVENTVALIDATION: eventValidation,
      TxtKeyword: stockId,
      RadioButton_Normal: "RadioButton_Normal",
      TxtCaptcha: captcha,
      btnOK: "查詢",
    });
    const postResp = await fetch(BSR_MENU, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jarToHeader(jar),
        Referer: BSR_MENU,
      },
      body: form.toString(),
    });
    Object.assign(jar, parseSetCookie(postResp.headers));

    // 成功時 302 → bsContent.aspx?StockNo=xxxx；失敗時 200 + 「識別碼有誤」
    const loc = postResp.headers.get("location");
    if (postResp.status === 302 && loc && loc.includes("bsContent.aspx")) {
      const contentUrl = loc.startsWith("http") ? loc : `${BSR_HOST}/bshtm/${loc.replace(/^\.?\//, "")}`;
      const contentResp = await fetch(contentUrl, {
        headers: { "User-Agent": UA, Cookie: jarToHeader(jar), Referer: BSR_MENU },
      });
      const contentHtml = await contentResp.text();
      return parseBsContent(contentHtml);
    }
    // captcha 錯 → 下一輪重新 OCR（VIEWSTATE 仍有效）
  }
  throw new Error("captcha_retry_exhausted");
}

// 週末回退到最近一個週五
function rollBackToWeekday(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  while (true) {
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return dt.toISOString().slice(0, 10);
}

// 往前一個「工作日」（週末自動跳過）
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const explicit: string[] = Array.isArray(body?.stock_ids) ? body.stock_ids : [];
    const limit = Math.min(Number(body?.limit) || 20, 50);
    const rawDate = String(body?.date || taipeiTodayISO());
    // 沒最新就抓前一天最新的（週末自動回退到週五）
    const tradeDate = rollBackToWeekday(rawDate);
    // 每檔股票最多回退 N 個交易日（含起始日），預設 5，上限 7
    const lookback = Math.min(Math.max(Number(body?.lookback) || 5, 1), 7);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });


    // 決定股票清單
    let stocks: string[] = explicit.filter((s) => /^[0-9]{4,6}$/.test(s));
    if (stocks.length === 0) {
      const { data } = await supa
        .from("tw_institutional_daily")
        .select("stock_id, trade_date")
        .gte("trade_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
        .order("trade_date", { ascending: false })
        .limit(500);
      const set = new Set<string>();
      for (const r of data || []) {
        if (/^[0-9]{4,6}$/.test(r.stock_id) && !set.has(r.stock_id)) set.add(r.stock_id);
        if (set.size >= limit) break;
      }
      stocks = Array.from(set);
    }

    const results: Array<{
      stock_id: string;
      ok: boolean;
      rows?: number;
      resolved_date?: string;
      attempts?: Array<{ date: string; error: string }>;
      error?: string;
    }> = [];

    for (const stockId of stocks) {
      const attempts: Array<{ date: string; error: string }> = [];
      let resolvedDate: string | null = null;
      let resolvedRows = 0;
      let lastError = "";

      let cursor = tradeDate;
      for (let step = 0; step < lookback; step++) {
        if (step > 0) cursor = prevWeekday(cursor);

        // 已有該日資料 → 視同成功（避免重覆抓 & OCR）
        const { count: existCount } = await supa
          .from("tw_bsr_daily")
          .select("broker_id", { count: "exact", head: true })
          .eq("stock_id", stockId)
          .eq("trade_date", cursor);
        if ((existCount || 0) > 0) {
          resolvedDate = cursor;
          resolvedRows = existCount || 0;
          // 確保 rollup 也是最新
          await rebuildRollup(supa, stockId, cursor);
          break;
        }

        try {
          const rows = await fetchBsrForStock(stockId);
          if (rows.length === 0) throw new Error("empty_rows");

          await supa.from("tw_bsr_daily").delete().eq("stock_id", stockId).eq("trade_date", cursor);
          const payload = rows.map((r) => ({
            stock_id: stockId,
            trade_date: cursor,
            broker_id: r.broker_id,
            broker_name: r.broker_name,
            buy_shares: r.buy_shares,
            sell_shares: r.sell_shares,
            net_shares: r.buy_shares - r.sell_shares,
            avg_buy_price: r.avg_buy_price,
            avg_sell_price: r.avg_sell_price,
          }));
          const { error: insErr } = await supa.from("tw_bsr_daily").insert(payload);
          if (insErr) throw new Error(`db_insert:${insErr.message}`);

          await rebuildRollup(supa, stockId, cursor);

          await supa
            .from("tw_bsr_fetch_failures")
            .update({ resolved_at: new Date().toISOString() })
            .eq("stock_id", stockId)
            .eq("trade_date", cursor)
            .is("resolved_at", null);

          resolvedDate = cursor;
          resolvedRows = rows.length;
          break;
        } catch (err) {
          const msg = (err as Error).message || "unknown";
          const reason = /captcha_retry_exhausted|captcha_http|menu_parse_failed|empty_rows/.test(msg)
            ? msg.split(":")[0]
            : "sync_failed";
          await supa.from("tw_bsr_fetch_failures").upsert(
            {
              stock_id: stockId,
              trade_date: cursor,
              reason,
              attempts: step + 1,
              last_error: msg,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "stock_id,trade_date" },
          );
          attempts.push({ date: cursor, error: msg });
          lastError = msg;
        }
      }

      if (resolvedDate) {
        results.push({ stock_id: stockId, ok: true, rows: resolvedRows, resolved_date: resolvedDate, attempts });
      } else {
        results.push({ stock_id: stockId, ok: false, error: lastError || "no_data", attempts });
      }
    }

    return jsonResponse({
      date: tradeDate,
      lookback,
      processed: stocks.length,
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});


// ---- rollup helper ----
async function rebuildRollup(supa: any, stockId: string, asOf: string) {
  // 抓最近 60 交易日的 BSR
  const since = new Date(asOf);
  since.setDate(since.getDate() - 90); // 日曆 90 天約覆蓋 60 個交易日
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

    // 累加每個券商
    const agg = new Map<string, { name: string; net: number; buy: number; sell: number }>();
    for (const r of slice) {
      const cur = agg.get(r.broker_id) || { name: r.broker_name, net: 0, buy: 0, sell: 0 };
      cur.net += Number(r.net_shares || 0);
      cur.buy += Number(r.buy_shares || 0);
      cur.sell += Number(r.sell_shares || 0);
      agg.set(r.broker_id, cur);
    }
    const list = Array.from(agg.entries()).map(([broker_id, v]) => ({
      broker_id,
      name: v.name,
      net: v.net,
      buy: v.buy,
      sell: v.sell,
    }));

    const topBuy = [...list].sort((a, b) => b.net - a.net).slice(0, 3).map((b) => ({
      broker_id: b.broker_id, name: b.name, net: b.net,
    }));
    const topSell = [...list].sort((a, b) => a.net - b.net).slice(0, 3).map((b) => ({
      broker_id: b.broker_id, name: b.name, net: b.net,
    }));

    // 集中度：買方前 15 大 net / 總買股數 * 100
    const totalBuy = list.reduce((s, b) => s + b.buy, 0);
    const top15Buy = [...list].sort((a, b) => b.buy - a.buy).slice(0, 15).reduce((s, b) => s + b.buy, 0);
    const concentration = totalBuy > 0 ? (top15Buy / totalBuy) * 100 : null;

    await supa.from("tw_chips_rollup").upsert(
      {
        stock_id: stockId,
        as_of_date: asOf,
        window_days: win,
        foreign_net: 0,
        trust_net: 0,
        dealer_net: 0,
        top_buy_brokers: topBuy,
        top_sell_brokers: topSell,
        concentration_ratio: concentration,
        bsr_available: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stock_id,as_of_date,window_days" },
    );
  }
}
