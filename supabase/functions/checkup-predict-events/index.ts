// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/* ── helpers ── */

function extractJsonArray(text: string): any[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  // bracket-depth matching
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '[') { if (depth === 0) start = i; depth++; }
    else if (cleaned[i] === ']') { depth--; if (depth === 0 && start !== -1) return JSON.parse(cleaned.substring(start, i + 1)); }
  }
  throw new Error('No JSON array found');
}

/** Fetch real-time quotes from TWSE MIS API for given stock codes */
async function fetchRealtimeQuotes(codes: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  if (!codes.length) return result;

  const unique = [...new Set(codes)];
  // Build ex_ch param: try both tse and otc
  const exCh = unique.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]).join('|');

  try {
    const ts = Date.now();
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${ts}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    const data = await res.json();
    const items = data?.msgArray || [];

    for (const item of items) {
      if (!item.c) continue;
      if (result.has(item.c)) continue; // keep first valid

      const z = parseFloat(item.z); // 成交價
      const y = parseFloat(item.y); // 昨收
      const v = parseInt(item.v, 10) || 0; // 成交量(張)
      const h = parseFloat(item.h); // 最高
      const l = parseFloat(item.l); // 最低
      const o = parseFloat(item.o); // 開盤

      const price = !isNaN(z) && z > 0 ? z : (!isNaN(h) && h > 0 && v > 0 ? h : y);
      const changePercent = !isNaN(y) && y > 0 && !isNaN(price) ? ((price - y) / y * 100) : 0;

      result.set(item.c, {
        code: item.c,
        name: item.n || '',
        price: isNaN(price) ? null : price,
        yesterdayClose: isNaN(y) ? null : y,
        changePercent: Math.round(changePercent * 100) / 100,
        volume: v,
        high: isNaN(h) ? null : h,
        low: isNaN(l) ? null : l,
        open: isNaN(o) ? null : o,
      });
    }
  } catch (err) {
    console.error('Fetch realtime quotes error:', err);
  }
  return result;
}

async function callGeminiWithGrounding(geminiKey: string, prompt: string): Promise<string> {
  // Layer 1: Google Search Grounding (no JSON mode)
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
        }),
      },
    );
    if (res.status === 429) {
      console.warn('Gemini grounding 429, wait 60s...');
      await new Promise(r => setTimeout(r, 60000));
      const retry = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
          }),
        },
      );
      if (retry.ok) {
        const d = await retry.json();
        const t = (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text ?? '').join('').trim();
        if (t) return t;
      }
    } else if (res.ok) {
      const d = await res.json();
      const t = (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text ?? '').join('').trim();
      if (t) return t;
    }
  } catch (err) {
    console.error('Gemini grounding error:', err);
  }

  // Layer 2: Plain JSON mode (no grounding)
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
      },
    );
    if (res.ok) {
      const d = await res.json();
      const t = (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text ?? '').join('').trim();
      if (t) return t;
    }
  } catch (err) {
    console.error('Gemini plain error:', err);
  }

  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const geminiKey = Deno.env.get('GEMINI_ANALYSIS_API_KEY');

  if (!geminiKey) {
    return new Response(JSON.stringify({ error: 'No Gemini API key configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { events, holdings } = await req.json();

    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing events array' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 1. Collect all stock codes from events + holdings ──
    const allCodes = new Set<string>();
    for (const e of events) {
      for (const s of (e.stocks || [])) {
        const code = typeof s === 'string' ? s.match(/^\d{4,6}/)?.[0] : (s.code || '').match(/^\d{4,6}/)?.[0];
        if (code) allCodes.add(code);
      }
    }
    for (const h of (holdings || [])) {
      const code = String(h.code || '').match(/^\d{4,6}/)?.[0];
      if (code) allCodes.add(code);
    }

    // ── 2. Fetch real-time quotes ──
    const quotes = await fetchRealtimeQuotes([...allCodes]);

    // ── 3. Build enriched context ──
    const holdingsSummary = (holdings || [])
      .map((h: any) => {
        const code = String(h.code || '').match(/^\d{4,6}/)?.[0] || h.code;
        const q = quotes.get(code);
        const qInfo = q
          ? `即時報價${q.price} 漲跌幅${q.changePercent}% 成交量${q.volume}張 昨收${q.yesterdayClose}`
          : '';
        return `${h.code} ${h.name} 成本${h.costPrice} 現價${h.marketPrice || h.costPrice} ${qInfo}`;
      })
      .join('\n');

    const eventsForPrompt = events.map((e: any, i: number) => {
      // Attach quote data to each event's stocks
      const stocksInfo = (e.stocks || []).map((s: any) => {
        const code = typeof s === 'string' ? s.match(/^\d{4,6}/)?.[0] : (s.code || '').match(/^\d{4,6}/)?.[0];
        const name = typeof s === 'string' ? s : (s.name || '');
        const q = code ? quotes.get(code) : null;
        if (q) {
          return `${code} ${name} [即時:${q.price} 漲跌${q.changePercent}% 量${q.volume}張 開${q.open} 高${q.high} 低${q.low} 昨收${q.yesterdayClose}]`;
        }
        return `${code || ''} ${name}`;
      }).join(', ');

      return `${i + 1}. [${e.date}] ${e.title} — ${e.detail || '無細節'} (相關股票: ${stocksInfo})`;
    }).join('\n');

    const prompt = `# 角色
你是台股市場資深分析師，擅長根據事件預判對個股的漲跌影響。你能使用 Google 搜尋獲取最新市場消息來輔助判斷。

# 任務
以下是即將在 7 天內發生的事件，請先搜尋相關最新消息（如：該公司近期營收、法人買賣超、產業趨勢、市場情緒等），再根據搜尋結果 + 即時報價數據 + 事件性質，預測其對相關個股的影響方向。

# 目前持倉（含即時報價）
${holdingsSummary || '無持倉資訊'}

# 待預測事件（含即時報價數據）
${eventsForPrompt}

# 輸出格式
輸出 JSON 陣列，每個元素對應一個事件：
[
  {
    "index": 1,
    "pred": "up" 或 "down" 或 "neutral",
    "predReason": "一句話說明預測邏輯（30字內），需引用搜尋到的具體數據或資訊"
  }
]

# 預測規則
- pred 只能是 "up"、"down"、"neutral" 三者之一
- predReason 必須具體，引用你搜尋到的實際數據（如：前月營收YoY+15%、外資連3日買超、殖利率5.2%等）
- 綜合考量以下因素：
  1. 搜尋到的最新消息與數據
  2. 即時報價的漲跌趨勢與成交量
  3. 事件歷史規律（營收看YoY/MoM、法說看展望、除息看填息率等）
  4. 市場整體氛圍
- 只輸出 JSON 陣列，不要其他文字`;

    let resultText = '';

    // Layer 1: Gemini with Google Search Grounding
    if (geminiKey) {
      resultText = await callGeminiWithGrounding(geminiKey, prompt);
    }


    // No fallback — Gemini only

    if (!resultText) {
      return new Response(JSON.stringify({ error: '預測失敗，所有模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse result
    let predictions: any[] = [];
    try {
      predictions = extractJsonArray(resultText);
    } catch (err) {
      console.error('Parse predictions failed:', err, resultText.slice(0, 500));
      return new Response(JSON.stringify({ error: '預測結果解析失敗' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ predictions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Predict events error:', err);
    return new Response(JSON.stringify({ error: '預測失敗', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
