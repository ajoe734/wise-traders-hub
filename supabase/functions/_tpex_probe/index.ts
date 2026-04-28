// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async () => {
  const targets = [
    "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?monthDate=115/04&code=6274&id=&response=json",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  ];
  const out: any[] = [];
  for (const url of targets) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
      });
      const text = await res.text();
      out.push({ url, status: res.status, len: text.length, head: text.slice(0, 200) });
    } catch (e) {
      out.push({ url, err: String(e) });
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
