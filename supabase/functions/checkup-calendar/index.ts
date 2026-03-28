// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface GeminiResult {
  ok: boolean;
  text: string;
  status: number;
  statusLabel: string;
}

async function callGeminiWithGrounding(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
): Promise<GeminiResult> {
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
          tools: [{ google_search: {} }],
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini ${model} failed (${response.status}):`, errText.slice(0, 800));
      return { ok: false, text: errText, status: response.status, statusLabel: String(response.status) };
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
    const text = textParts.join('').trim();

    // Log grounding metadata if present
    const groundingMeta = data.candidates?.[0]?.groundingMetadata;
    if (groundingMeta) {
      const queries = groundingMeta.webSearchQueries || [];
      console.log(`Grounding queries: ${JSON.stringify(queries)}`);
    }

    if (!text) {
      console.error(`Gemini ${model} returned empty content. Response snippet:`, JSON.stringify(data).slice(0, 600));
      return { ok: false, text: '', status: 200, statusLabel: 'empty' };
    }

    return { ok: true, text, status: 200, statusLabel: 'ok' };
  } catch (err) {
    console.error(`Gemini ${model} exception:`, err);
    return { ok: false, text: String(err), status: 500, statusLabel: 'exception' };
  }
}

// Fallback without grounding (for models that don't support it or when grounding fails)
async function callGeminiPlain(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
): Promise<GeminiResult> {
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
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini ${model} plain failed (${response.status}):`, errText.slice(0, 500));
      return { ok: false, text: errText, status: response.status, statusLabel: String(response.status) };
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text ?? '').join('').trim();

    if (!text) {
      return { ok: false, text: '', status: 200, statusLabel: 'empty' };
    }
    return { ok: true, text, status: 200, statusLabel: 'ok' };
  } catch (err) {
    console.error(`Gemini ${model} plain exception:`, err);
    return { ok: false, text: String(err), status: 500, statusLabel: 'exception' };
  }
}

function tryParseEvents(text: string): any[] | null {
  try {
    // Try direct parse
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch {
    // Try extracting JSON array from text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch { /* ignore */ }
    }
    return null;
  }
}

function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  return `# Role
你是一位頂級 AI 財經分析師，精通台股市場，善於搜尋並彙整即時資訊。

# Task Objective
針對以下持倉標的，利用網路搜尋找出「${today} 的隔天起到 ${endDate}」的重要事件行事曆。

持倉標的：${stocks}

# 事件類別（8 大類，每一類都要盡量列出）
1. **營收**：每月營收公布（次月10日前）— 根據規則推算即可
2. **財報**：季度財報公布截止日 — 根據規則推算即可
3. **法說**：法說會、業績發表會、線上法說 — 請搜尋各公司近期法說會排程
4. **除息**：除權息日、配息基準日 — 請搜尋各公司股利政策與除息日
5. **總經**：央行會議、FOMC、CPI、GDP、非農就業等影響台股的重大事件
6. **催化**：產業展覽（如 Computex、CES）、新品發表、重大訂單、技術突破、政策利多
7. **到期**：權證到期日（權證代碼通常為6碼，名稱含「購」「售」「牛」「熊」）
8. **操作**：股東會、董事會、庫藏股、大股東申報轉讓

# 重要指引
- 請積極搜尋每檔標的的最新法說會、除息、股東會等日程
- 權證標的：同時列出其母股（標的股）的重要事件，標明影響哪檔權證
- 每檔標的至少列出月營收和季度財報相關事件
- 搜尋不到具體日期的動態事件，可以省略，但可推算的事件（營收、財報截止日）必須列出
- 不要包含今天(${today})或過去的事件
- 日期格式必須是 YYYY/MM/DD

# Output Format
${outputFormat}

只輸出 JSON 陣列，不要包含任何其他文字。`;
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

    // Strategy 1: gemini-2.5-flash with Google Search grounding (single call)
    const model = 'gemini-2.5-flash';
    console.log(`Calendar: calling ${model} WITH grounding + responseMimeType=application/json`);
    const result = await callGeminiWithGrounding(apiKey, model, prompt, 0.3);

    if (result.ok && result.text) {
      const events = tryParseEvents(result.text);
      if (events) {
        const cleaned = JSON.stringify(events);
        console.log(`Calendar: grounding succeeded, ${events.length} events`);
        return new Response(JSON.stringify({ text: cleaned, response: cleaned }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error(`Calendar: grounding returned text but parse failed. First 500 chars:`, result.text.slice(0, 500));
    }

    // Strategy 2: same model without grounding (in case grounding caused issues)
    console.log(`Calendar: fallback to ${model} WITHOUT grounding`);
    const fallback1 = await callGeminiPlain(apiKey, model, prompt, 0.3);

    if (fallback1.ok && fallback1.text) {
      const events = tryParseEvents(fallback1.text);
      if (events) {
        const cleaned = JSON.stringify(events);
        console.log(`Calendar: plain ${model} succeeded, ${events.length} events`);
        return new Response(JSON.stringify({ text: cleaned, response: cleaned }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Strategy 3: lite model without grounding
    const liteModel = 'gemini-2.5-flash-lite';
    console.log(`Calendar: fallback to ${liteModel}`);
    const fallback2 = await callGeminiPlain(apiKey, liteModel, prompt, 0.3);

    if (fallback2.ok && fallback2.text) {
      const events = tryParseEvents(fallback2.text);
      if (events) {
        const cleaned = JSON.stringify(events);
        console.log(`Calendar: ${liteModel} succeeded, ${events.length} events`);
        return new Response(JSON.stringify({ text: cleaned, response: cleaned }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      error: '行事曆產生失敗，所有模型均無法使用',
      detail: `${model}+grounding(${result.statusLabel}), ${model}(${fallback1.statusLabel}), ${liteModel}(${fallback2.statusLabel})`,
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
