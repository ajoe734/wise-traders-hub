// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** 從 MIS 五檔報價字串取第一個價格，如 "1.9000_2.2300_" → 1.9 */
function parseFirstPrice(str: string | undefined): number | null {
  if (!str) return null;
  const first = str.split('_')[0];
  const val = parseFloat(first);
  return (!isNaN(val) && val > 0) ? val : null;
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

    // Step 1: 嘗試 MIS 即時報價 API
    const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    const response = await fetch(twseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    });
    const data = await response.json();

    // 檢查哪些股票 z 無效（非交易時間）
    const msgArray = data?.msgArray || [];
    const missingCodes: string[] = [];
    const validCodes = new Set<string>();

    for (const item of msgArray) {
      const z = parseFloat(item.z);
      if (!isNaN(z) && z > 0) {
        validCodes.add(item.c);
      } else if (item.c) {
        missingCodes.push(item.c);
      }
    }

    // Step 2: 若有股票 z 無效，從 TWSE/TPEX 盤後 EOD API 補齊
    if (missingCodes.length > 0) {
      const eodPrices = new Map<string, number>();

      // 同時查 TWSE 和 TPEX 盤後收盤價
      const [twseEod, tpexEod] = await Promise.allSettled([
        fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        }).then(r => r.ok ? r.json() : []),
        fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes', {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        }).then(r => r.ok ? r.json() : []),
      ]);

      // TWSE EOD: Code + ClosingPrice
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

      // TPEX EOD: SecuritiesCompanyCode + Close
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

      // 將盤後價格注入 msgArray 的 z 欄位
      for (const item of msgArray) {
        if (!validCodes.has(item.c) && item.c) {
          if (eodPrices.has(item.c)) {
            // EOD 找到了
            item.z = String(eodPrices.get(item.c));
          } else {
            // Step 3: EOD 也找不到（例如權證），改用 MIS 的 best bid/ask 或昨收價
            const bestBid = parseFirstPrice(item.b);
            const bestAsk = parseFirstPrice(item.a);
            const yesterday = parseFloat(item.y);
            const lastH = parseFloat(item.h);
            const lastL = parseFloat(item.l);

            let fallbackPrice: number | null = null;

            // 優先用 bid/ask 中間價
            if (bestBid && bestAsk) {
              fallbackPrice = Math.round(((bestBid + bestAsk) / 2) * 10000) / 10000;
            } else if (bestAsk) {
              fallbackPrice = bestAsk;
            } else if (bestBid) {
              fallbackPrice = bestBid;
            }
            // 其次用今日最高/最低中間價
            if (!fallbackPrice && !isNaN(lastH) && lastH > 0 && !isNaN(lastL) && lastL > 0) {
              fallbackPrice = Math.round(((lastH + lastL) / 2) * 10000) / 10000;
            }
            // 最後用昨收
            if (!fallbackPrice && !isNaN(yesterday) && yesterday > 0) {
              fallbackPrice = yesterday;
            }

            if (fallbackPrice) {
              item.z = String(fallbackPrice);
            }
          }
        }
      }
    }

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
