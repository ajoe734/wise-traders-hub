// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** 判斷 z 是否在 h/l 合理範圍（容許 1% 誤差） */
function isZValid(z: number, h: number, l: number): boolean {
  if (isNaN(z) || z <= 0) return false;
  if (!isNaN(h) && h > 0 && !isNaN(l) && l > 0) {
    return z >= l * 0.99 && z <= h * 1.01;
  }
  return true; // h/l 不可用時，只要 z>0 就暫認有效
}

/** 為單個 item 評分，分數越高越可靠 */
function scoreItem(item: Record<string, string>): number {
  let score = 0;
  const z = parseFloat(item.z);
  const h = parseFloat(item.h);
  const l = parseFloat(item.l);
  const v = parseFloat(item.v); // 成交量

  if (!isNaN(z) && z > 0) score += 10;
  if (!isNaN(h) && h > 0) score += 2;
  if (!isNaN(l) && l > 0) score += 2;
  if (!isNaN(v) && v > 0) score += 5; // 有成交量代表確實有交易
  if (isZValid(z, h, l)) score += 20; // z 在合理範圍加大分

  return score;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const exCh = url.searchParams.get('ex_ch');

    if (!exCh) {
      return new Response(JSON.stringify({ error: '缺少 ex_ch 參數' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: MIS 即時報價 API
    const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    const response = await fetch(twseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    const data = await response.json();

    const rawArray = data?.msgArray || [];

    // ── 去重：同一 code 可能有 tse/otc 兩筆，保留分數最高的 ──
    const bestByCode = new Map<string, Record<string, string>>();
    for (const item of rawArray) {
      if (!item.c) continue;
      const existing = bestByCode.get(item.c);
      if (!existing || scoreItem(item) > scoreItem(existing)) {
        bestByCode.set(item.c, item);
      }
    }
    const msgArray = Array.from(bestByCode.values());

    // 分類：z 有效 vs 需要補齊
    const missingCodes: string[] = [];
    const validCodes = new Set<string>();

    for (const item of msgArray) {
      const z = parseFloat(item.z);
      const h = parseFloat(item.h);
      const l = parseFloat(item.l);

      if (isZValid(z, h, l)) {
        validCodes.add(item.c);
      } else {
        missingCodes.push(item.c);
      }
    }

    // Step 2: 盤後 EOD API 補齊
    if (missingCodes.length > 0) {
      const eodPrices = new Map<string, number>();

      const [twseEod, tpexEod] = await Promise.allSettled([
        fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        }).then(r => r.ok ? r.json() : []),
        fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes', {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        }).then(r => r.ok ? r.json() : []),
      ]);

      if (twseEod.status === 'fulfilled' && Array.isArray(twseEod.value)) {
        for (const item of twseEod.value) {
          if (missingCodes.includes(item.Code)) {
            const price = parseFloat(item.ClosingPrice);
            if (!isNaN(price) && price > 0) {
              eodPrices.set(item.Code, price);
            }
          }
        }
      }

      if (tpexEod.status === 'fulfilled' && Array.isArray(tpexEod.value)) {
        for (const item of tpexEod.value) {
          const code = item.SecuritiesCompanyCode || item.Code;
          if (code && missingCodes.includes(code) && !eodPrices.has(code)) {
            const price = parseFloat(item.Close || item.ClosingPrice);
            if (!isNaN(price) && price > 0) {
              eodPrices.set(code, price);
            }
          }
        }
      }

      // 將價格注入 msgArray
      for (const item of msgArray) {
        if (!item.c || validCodes.has(item.c)) continue;

        if (eodPrices.has(item.c)) {
          item.z = String(eodPrices.get(item.c));
          continue;
        }

        // Step 3: EOD 找不到（權證等），用 MIS 盤中數據推算
        const h = parseFloat(item.h);
        const l = parseFloat(item.l);
        const yesterday = parseFloat(item.y);

        let fallbackPrice: number | null = null;

        // 優先用盤中最高價（收盤通常接近最後成交的最高價附近）
        if (!isNaN(h) && h > 0 && !isNaN(l) && l > 0) {
          // 如果 h 和 l 差距很小，取中間值；差距大則偏向 h（收盤常接近高點或低點）
          fallbackPrice = Math.round(((h + l) / 2) * 10000) / 10000;
        } else if (!isNaN(h) && h > 0) {
          fallbackPrice = h;
        }

        // 其次用昨收
        if (!fallbackPrice && !isNaN(yesterday) && yesterday > 0) {
          fallbackPrice = yesterday;
        }

        if (fallbackPrice) {
          item.z = String(fallbackPrice);
        }
      }
    }

    // 回傳去重後的 msgArray
    data.msgArray = msgArray;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store' },
    });
  } catch (error) {
    console.error('TWSE proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'TWSE API 請求失敗', detail: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});