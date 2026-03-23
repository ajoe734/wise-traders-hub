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
        if (!validCodes.has(item.c) && eodPrices.has(item.c)) {
          item.z = String(eodPrices.get(item.c));
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
