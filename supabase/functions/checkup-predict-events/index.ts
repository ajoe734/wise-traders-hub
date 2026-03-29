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
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const geminiKey = Deno.env.get('GEMINI_ANALYSIS_API_KEY');

  if (!lovableKey && !geminiKey) {
    return new Response(JSON.stringify({ error: 'No AI API key configured' }), {
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

    // Build context about current holdings
    const holdingsSummary = (holdings || [])
      .map((h: any) => `${h.code} ${h.name} 成本${h.costPrice} 現價${h.marketPrice || h.costPrice}`)
      .join('、');

    const eventsForPrompt = events.map((e: any, i: number) =>
      `${i + 1}. [${e.date}] ${e.title} — ${e.detail || '無細節'} (相關股票: ${(e.stocks || []).map((s: any) => typeof s === 'string' ? s : `${s.code || ''} ${s.name || ''}`).join(', ')})`
    ).join('\n');

    const prompt = `# 角色
你是台股市場資深分析師，擅長根據事件預判對個股的漲跌影響。

# 任務
以下是即將在 7 天內發生的事件，請針對每個事件預測其對相關個股的影響方向（看漲/看跌/中性），並給出簡潔的預測邏輯。

# 目前持倉
${holdingsSummary || '無持倉資訊'}

# 待預測事件
${eventsForPrompt}

# 輸出格式
輸出 JSON 陣列，每個元素對應一個事件：
[
  {
    "index": 1,
    "pred": "up" 或 "down" 或 "neutral",
    "predReason": "一句話說明預測邏輯（30字內）"
  }
]

規則：
- pred 只能是 "up"、"down"、"neutral" 三者之一
- predReason 要具體，不要泛泛而談
- 根據事件性質、歷史規律、市場慣例來判斷
- 營收公布：看前月營收趨勢
- 法說會：看近期業績與展望
- 除息：看殖利率與填息機率
- 總經事件：看對大盤的影響方向
- 只輸出 JSON 陣列，不要其他文字`;

    let resultText = '';

    // Try Gemini first
    if (geminiKey) {
      try {
        const response = await fetch(
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
        if (response.ok) {
          const data = await response.json();
          resultText = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text ?? '').join('').trim();
        }
      } catch (err) {
        console.error('Gemini predict error:', err);
      }
    }

    // Fallback to Lovable AI
    if (!resultText && lovableKey) {
      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: '你是台股分析師，只輸出 JSON 陣列。' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 8192,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          resultText = data.choices?.[0]?.message?.content || '';
        }
      } catch (err) {
        console.error('Lovable AI predict error:', err);
      }
    }

    if (!resultText) {
      return new Response(JSON.stringify({ error: '預測失敗，所有模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse result
    let predictions: any[] = [];
    try {
      const cleaned = resultText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start !== -1 && end !== -1) {
        predictions = JSON.parse(cleaned.substring(start, end + 1));
      }
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
