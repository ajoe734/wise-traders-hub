// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');

    if (!date || !/^\d{8}$/.test(date)) {
      return new Response(JSON.stringify({ error: '日期格式錯誤，請使用 YYYYMMDD' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&rt=true`;
    const response = await fetch(twseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) throw new Error(`TWSE API 回應錯誤：${response.status}`);
    const data = await response.json();

    return new Response(JSON.stringify({
      date,
      available: !!data?.data,
      data: data?.data || [],
      fields: data?.fields || [],
      fetchedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Institutional API error:', err);
    return new Response(JSON.stringify({
      error: '三大法人數據抓取失敗',
      detail: (err as Error).message,
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
