// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function callGemini(apiKey: string, model: string, prompt: string, temperature: number): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      }
    );
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini ${model} failed (${response.status}):`, errText);
      return { ok: false, text: errText, status: response.status };
    }
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text ?? '').join('').trim();
    if (!text) {
      console.error(`Gemini ${model} returned empty content`, JSON.stringify(data).slice(0, 500));
      return { ok: false, text: '', status: 200 };
    }
    return { ok: true, text, status: 200 };
  } catch (err) {
    console.error(`Gemini ${model} exception:`, err);
    return { ok: false, text: String(err), status: 500 };
  }
}

function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  return `# Role
你是一位頂級 AI 財經分析師，精通台股市場。

# Task Objective
針對以下持倉標的，列出「${today} 的隔天起到 ${endDate}」的重要事件行事曆。

持倉標的：${stocks}

# 事件類別（8 大類）
- **營收**：每月營收公布（次月10日前）
- **財報**：季度財報公布截止日
- **法說**：法說會、業績發表會
- **除息**：除權息日、配息基準日
- **總經**：央行會議、FOMC、CPI、GDP 等影響台股的重大事件
- **催化**：產業展覽、新品發表、大客戶訂單、技術突破、政策利多
- **到期**：權證到期日（權證代碼通常為6碼，名稱含「購」「售」「牛」「熊」）
- **操作**：股東會、董事會、庫藏股、大股東申報轉讓

# 重要指引
- 權證標的：同時列出其母股（標的股）的重要事件，標明影響哪檔權證
- 每檔標的至少列出月營收和季度財報相關事件
- 禁止幻覺：若無具體依據，不要編造事件
- 不要包含今天(${today})或過去的事件
- 根據一般規則推算事件日期（如月營收次月10日前公布、季報截止日等）

# Output Format
${outputFormat}

只輸出 JSON 陣列。`;
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

  const apiKey = Deno.env.get('GEMINI_ANALYSIS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_ANALYSIS_API_KEY is not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { stocks, today, endDate } = body;

    if (!stocks) {
      return new Response(JSON.stringify({ error: 'Missing stocks parameter' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const outputFormat = `JSON陣列，每個元素格式：
{"date":"YYYY/MM/DD","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/到期","sources":[]}

規則：
- sources 給空陣列 []
- date 必須用 YYYY/MM/DD 格式
- urgent=true 僅限未來一週內的事件
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序`;

    const prompt = buildPrompt(stocks, today, endDate, outputFormat);
    const model = 'gemini-2.5-flash';

    console.log(`Calendar: calling ${model} with responseMimeType=application/json`);
    const result = await callGemini(apiKey, model, prompt, 0.3);

    if (result.ok && result.text) {
      try {
        const parsed = JSON.parse(result.text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = JSON.stringify(parsed);
          console.log(`Calendar: succeeded, ${parsed.length} events`);
          return new Response(JSON.stringify({ text: cleaned, response: cleaned }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.error(`Calendar: parsed but empty or not array. First 300 chars:`, result.text.slice(0, 300));
      } catch (e) {
        console.error(`Calendar: JSON.parse failed. First 500 chars:`, result.text.slice(0, 500));
      }
    }

    // Fallback: try lite model
    const fallbackModel = 'gemini-2.5-flash-lite';
    console.log(`Calendar: fallback to ${fallbackModel}`);
    const fallback = await callGemini(apiKey, fallbackModel, prompt, 0.3);

    if (fallback.ok && fallback.text) {
      try {
        const parsed = JSON.parse(fallback.text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = JSON.stringify(parsed);
          console.log(`Calendar: fallback succeeded, ${parsed.length} events`);
          return new Response(JSON.stringify({ text: cleaned, response: cleaned }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({
      error: '行事曆產生失敗，所有模型均無法使用',
      detail: `${model}(${result.status}), ${fallbackModel}(${fallback.status})`,
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Calendar error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '行事曆產生失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
