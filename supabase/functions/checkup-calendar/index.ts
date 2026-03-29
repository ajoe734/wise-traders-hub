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
  groundingSources?: string[];
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGeminiWithGrounding(
  apiKey: string, model: string, prompt: string, temperature: number,
): Promise<GeminiResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: 65536 },
            tools: [{ google_search: {} }],
          }),
        },
      );
      if (response.status === 429 && attempt === 0) {
        console.log(`Gemini ${model} grounding 429, waiting 60s then retry...`);
        await sleep(60000);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini ${model} grounding failed (${response.status}):`, errText.slice(0, 500));
        return { ok: false, text: errText, status: response.status, statusLabel: String(response.status) };
      }
      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
      const groundingMeta = data.candidates?.[0]?.groundingMetadata;
      const groundingSources: string[] = [];
      if (groundingMeta) {
        console.log(`Grounding queries: ${JSON.stringify(groundingMeta.webSearchQueries || [])}`);
        // Extract real source URLs from grounding chunks
        const chunks = groundingMeta.groundingChunks || groundingMeta.supportingChunks || [];
        for (const chunk of chunks) {
          const uri = chunk?.web?.uri || chunk?.retrievedContext?.uri;
          if (uri && !uri.includes('lovable.app') && !uri.includes('lovable.dev')) {
            groundingSources.push(uri);
          }
        }
        if (groundingSources.length > 0) {
          console.log(`Grounding sources: ${groundingSources.length} URLs extracted`);
        }
      }
      if (!text) {
        console.error(`Gemini ${model} returned empty. Snippet:`, JSON.stringify(data).slice(0, 600));
        return { ok: false, text: '', status: 200, statusLabel: 'empty' };
      }
      return { ok: true, text, status: 200, statusLabel: 'ok', groundingSources };
    } catch (err) {
      console.error(`Gemini ${model} grounding exception:`, err);
      return { ok: false, text: String(err), status: 500, statusLabel: 'exception' };
    }
  }
  return { ok: false, text: 'retry exhausted', status: 429, statusLabel: '429' };
}

async function callGeminiPlain(
  apiKey: string, model: string, prompt: string, temperature: number,
): Promise<GeminiResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: 65536, responseMimeType: 'application/json' },
          }),
        },
      );
      if (response.status === 429 && attempt === 0) {
        console.log(`Gemini ${model} plain 429, waiting 60s then retry...`);
        await sleep(60000);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini ${model} plain failed (${response.status}):`, errText.slice(0, 500));
        return { ok: false, text: errText, status: response.status, statusLabel: String(response.status) };
      }
      const data = await response.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text ?? '').join('').trim();
      if (!text) return { ok: false, text: '', status: 200, statusLabel: 'empty' };
      return { ok: true, text, status: 200, statusLabel: 'ok' };
    } catch (err) {
      console.error(`Gemini ${model} plain exception:`, err);
      return { ok: false, text: String(err), status: 500, statusLabel: 'exception' };
    }
  }
  return { ok: false, text: 'retry exhausted', status: 429, statusLabel: '429' };
}

async function callLovableAI(apiKey: string, prompt: string): Promise<{ ok: boolean; text: string }> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: '你是台股財經分析師，只輸出 JSON 陣列，不輸出其他文字。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 32768,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Lovable AI failed (${response.status}):`, errText.slice(0, 500));
      return { ok: false, text: errText };
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) { console.error('Lovable AI returned empty'); return { ok: false, text: '' }; }
    return { ok: true, text };
  } catch (err) {
    console.error('Lovable AI exception:', err);
    return { ok: false, text: String(err) };
  }
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

function tryRepairTruncatedArray(text: string): any[] | null {
  // Find the start of the JSON array
  const start = text.indexOf('[');
  if (start === -1) return null;
  const sub = text.substring(start);
  // Find the last complete object by looking for the last "},"  or "}" 
  const lastCompleteObj = sub.lastIndexOf('}');
  if (lastCompleteObj === -1) return null;
  // Try closing the array after the last complete object
  const candidate = sub.substring(0, lastCompleteObj + 1) + ']';
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  // Try removing trailing comma
  const trimmed = candidate.replace(/,\s*\]$/, ']');
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  return null;
}

function tryParseEvents(text: string): any[] | null {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch { /* not pure JSON */ }

  // Clean markdown fences
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');

  // Use bracket-depth matching to extract the first complete JSON array
  const jsonStr = extractJsonArray(cleaned);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }

  // Fallback: try on original text
  const jsonStr2 = extractJsonArray(text);
  if (jsonStr2 && jsonStr2 !== jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr2);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }

  // Last resort: try to repair truncated JSON (output cut off by token limit)
  const repaired = tryRepairTruncatedArray(cleaned);
  if (repaired) {
    console.log(`Calendar: repaired truncated JSON, recovered ${repaired.length} events`);
    return repaired;
  }

  return null;
}

function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  return `# Role
你是一位頂級 AI 財經分析師，精通台股市場，善於搜尋並彙整即時資訊。

# Task Objective
針對以下持倉標的，利用網路搜尋找出「${today} 的隔天起到 ${endDate}」的重要事件行事曆。

持倉標的：${stocks}

# 事件類別（8 大類，每一類都要盡力搜尋並列出）
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
- **即使搜尋不到精確日期，也必須列出事件**，date 欄位可用模糊表達（見下方格式說明）
- 不要包含今天(${today})或過去的事件

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
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');

  if (!apiKey && !lovableKey) {
    return new Response(JSON.stringify({ error: 'No AI API key configured' }), {
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
{"date":"日期","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/到期"}

規則：
- 不需要 sources 欄位，系統會自動從搜尋結果中提取來源連結
- date 欄位：如果有精確日期，用 YYYY/MM/DD 格式；如果只知道月份，用「2025/07月」；如果只知道季度，用「2025 Q2」；如果尚未公布，用「尚未公布」或「待確認」。總之不要因為日期不精確就省略事件。
- urgent=true 僅限未來一週內的事件（模糊日期的事件 urgent=false）
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序，模糊日期的排在精確日期之後`;

    const prompt = buildPrompt(stocks, today, endDate, outputFormat);
    const attachSources = (events: any[], sources: string[]) => {
      if (!sources || sources.length === 0) return events;
      // Dedupe sources
      const uniqueSources = [...new Set(sources)];
      // Try to match sources to events by stock code or keyword in URL
      return events.map(ev => {
        const code = (ev.label || '').match(/\d{4}/)?.[0];
        const matched = uniqueSources.filter(url => {
          if (code && url.includes(code)) return true;
          // Match by event type keywords in URL
          const typeMap: Record<string, string[]> = {
            '法說': ['investor', 'conference', '法說'],
            '除息': ['dividend', '除息', '配息'],
            '總經': ['fed', 'fomc', 'cpi', 'gdp', 'macro', '央行'],
            '催化': ['exhibition', 'computex', 'ces', '展覽'],
            '營收': ['revenue', '營收'],
            '財報': ['earnings', '財報', 'report'],
          };
          const keywords = typeMap[ev.type] || [];
          const urlLower = url.toLowerCase();
          return keywords.some(kw => urlLower.includes(kw));
        });
        return { ...ev, sources: matched.length > 0 ? matched.slice(0, 3) : [] };
      });
    };

    const okResponse = (events: any[], sources?: string[]) => {
      const enriched = sources ? attachSources(events, sources) : events;
      return new Response(
        JSON.stringify({ text: JSON.stringify(enriched), response: JSON.stringify(enriched) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    };

    // Strategy 1: gemini-2.5-flash with Google Search grounding (includes 429 retry)
    if (apiKey) {
      const model = 'gemini-2.5-flash';
      console.log(`Calendar: calling ${model} WITH grounding`);
      const result = await callGeminiWithGrounding(apiKey, model, prompt, 0.3);

      if (result.ok && result.text) {
        const events = tryParseEvents(result.text);
        if (events) {
          console.log(`Calendar: grounding succeeded, ${events.length} events, ${(result.groundingSources||[]).length} sources`);
          return okResponse(events, result.groundingSources);
        }
        console.error(`Calendar: grounding parse failed. First 500:`, result.text.slice(0, 500));
      }

      // Strategy 2: same model without grounding (JSON mode)
      if (result.status !== 429) {
        console.log(`Calendar: fallback to ${model} WITHOUT grounding`);
        const fallback1 = await callGeminiPlain(apiKey, model, prompt, 0.3);
        if (fallback1.ok && fallback1.text) {
          const events = tryParseEvents(fallback1.text);
          if (events) {
            console.log(`Calendar: plain ${model} succeeded, ${events.length} events`);
            return okResponse(events);
          }
        }

        // Strategy 3: lite model
        const liteModel = 'gemini-2.5-flash-lite';
        console.log(`Calendar: fallback to ${liteModel}`);
        const fallback2 = await callGeminiPlain(apiKey, liteModel, prompt, 0.3);
        if (fallback2.ok && fallback2.text) {
          const events = tryParseEvents(fallback2.text);
          if (events) {
            console.log(`Calendar: ${liteModel} succeeded, ${events.length} events`);
            return okResponse(events);
          }
        }
      }
    }

    // Strategy 4: Lovable AI Gateway fallback
    if (lovableKey) {
      console.log('Calendar: falling back to Lovable AI Gateway');
      const lovResult = await callLovableAI(lovableKey, prompt);
      if (lovResult.ok && lovResult.text) {
        const events = tryParseEvents(lovResult.text);
        if (events) {
          console.log(`Calendar: Lovable AI succeeded, ${events.length} events`);
          return okResponse(events);
        }
      }
    }

    return new Response(JSON.stringify({ error: '行事曆產生失敗，所有模型均無法使用' }), {
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
