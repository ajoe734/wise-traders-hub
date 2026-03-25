// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    const msgArray = data?.msgArray || [];
    const missingCodes: string[] = [];
    const validCodes = new Set<string>();

    for (const item of msgArray) {
      if (!item.c) continue;
      const z = parseFloat(item.z);
      const h = parseFloat(item.h);
      const l = parseFloat(item.l);
      // z 有效且在合理範圍內（不超過漲停價、不低於跌停價）
      if (!isNaN(z) && z > 0) {
        // 額外檢查：如果 h/l 都有效，z 應在 l~h 之間（容許微幅誤差）
        if (!isNaN(h) && h > 0 && !isNaN(l) && l > 0) {
          if (z >= l * 0.99 && z <= h * 1.01) {
            validCodes.add(item.c);
          } else {
            // z 被 fallback 污染或異常，需要重新計算
            missingCodes.push(item.c);
          }
        } else {
          validCodes.add(item.c);
        }
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

        // 優先用盤中最高/最低中間價（這是實際成交過的價格範圍）
        if (!isNaN(h) && h > 0 && !isNaN(l) && l > 0) {
          // 收盤價通常接近最後成交，用 h 和 l 的中間值近似
          fallbackPrice = Math.round(((h + l) / 2) * 10000) / 10000;
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
