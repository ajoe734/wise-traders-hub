// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MODELS = ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'];

async function callClaude(apiKey: string, model: string, system: string, user: string, maxTokens = 900): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!response.ok) throw new Error(`Claude ${model} failed (${response.status})`);
  const data = await response.json();
  return data.content?.map((b: any) => b.text || '').join('').trim() || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY 未設定' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { report, stock, dossier } = await req.json();
    if (!report?.code || !report?.text) {
      return new Response(JSON.stringify({ error: '缺少 report.code 或 report.text' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `你是台股研究資料抽取器。你的任務是從研究報告文字中抽出可回寫到持股 dossier 的結構化資料。
只能抽出文字裡有明確提到的數字或來源，不可猜測。
0 不是缺值佔位符。除非原文真的明確寫出 0，否則缺資料一律填 null，不可用 0 代替。
回傳純 JSON，不要 markdown。

格式：
{
  "fundamentals": {
    "revenueMonth": "YYYY/MM" 或 null,
    "revenueYoY": 數字或 null,
    "revenueMoM": 數字或 null,
    "quarter": "YYYYQn" 或 null,
    "eps": 數字或 null,
    "grossMargin": 數字或 null,
    "roe": 數字或 null,
    "updatedAt": "YYYY/MM/DD" 或 null,
    "source": "資料來源簡述",
    "note": "一句話摘要"
  },
  "targets": {
    "reports": [
      { "firm": "券商/來源", "target": 數字, "date": "YYYY/MM/DD 或 YYYY/MM" }
    ]
  }
}`;

    const userPrompt = `股票：${stock?.name || report.name || ""}(${report.code})
研究日期：${report.date || ""}

現有 dossier 摘要：
${JSON.stringify(dossier || {}, null, 2)}

研究全文：
${report.text}

請抽出可回寫的財報/營收/目標價資料。`;

    let text = '';
    for (const model of MODELS) {
      try {
        text = await callClaude(apiKey, model, systemPrompt, userPrompt, 900);
        if (text) break;
      } catch (e) {
        console.error(`Model ${model} failed:`, e);
        continue;
      }
    }

    if (!text) {
      return new Response(JSON.stringify({ error: '所有 AI 模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanText = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    return new Response(JSON.stringify({
      fundamentals: parsed?.fundamentals || null,
      targets: parsed?.targets || { reports: [] },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Research extract error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '研究資料抽取失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
