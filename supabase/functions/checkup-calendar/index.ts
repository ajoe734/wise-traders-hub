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
        const chunks = groundingMeta.groundingChunks || [];
        for (const chunk of chunks) {
          const uri = chunk?.web?.uri;
          const title = chunk?.web?.title || '';
          if (uri) {
            // Google API returns proxy URLs (vertexaisearch.cloud.google.com)
            // Try to extract the real domain from the title field
            if (uri.includes('vertexaisearch.cloud.google.com')) {
              // title is like "aljazeera.com" — construct a likely URL
              if (title && !title.includes('lovable')) {
                const realUrl = title.startsWith('http') ? title : `https://${title}`;
                groundingSources.push(realUrl);
              }
            } else if (!uri.includes('lovable.app') && !uri.includes('lovable.dev')) {
              groundingSources.push(uri);
            }
          }
        }
        // Also check groundingSupports for any additional context
        const supports = groundingMeta.groundingSupports || [];
        for (const sup of supports) {
          const indices = sup?.groundingChunkIndices || [];
          // Already handled via chunks above
        }
        if (groundingSources.length > 0) {
          console.log(`Grounding sources: ${groundingSources.length} URLs extracted`);
        } else {
          console.log(`Grounding: no real source URLs found. Raw chunks: ${JSON.stringify(chunks.slice(0, 3))}`);
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

function classifyHoldings(stocks: string): { stockList: string; warrantList: string; parentStocks: string[] } {
  // Split by Chinese comma or regular comma
  const items = stocks.split(/[、,]/).map(s => s.trim()).filter(Boolean);
  const stockItems: string[] = [];
  const warrantItems: string[] = [];
  const parentStocks: string[] = [];
  
  for (const item of items) {
    const code = item.match(/^(\d+)/)?.[1] || '';
    const name = item.replace(/^\d+\s*/, '');
    // Warrant codes are typically 6 digits, and names contain 購/售/牛/熊
    const isWarrant = code.length === 6 || /[購售牛熊]/.test(name);
    if (isWarrant) {
      warrantItems.push(item);
      // Try to extract parent stock name from warrant name
      // Warrant names are like "華新元大5A購01" → parent is "華新"
      // Or "亞翔凱基5B購01" → parent is "亞翔"  
      // Pattern: company name comes before the broker name (凱基/元大/富邦/群益/統一/國票/永豐/中信/日盛/兆豐/台新/玉山)
      const brokerMatch = name.match(/^(.+?)(凱基|元大|富邦|群益|統一|國票|永豐|中信|日盛|兆豐|台新|玉山|永昌)/);
      if (brokerMatch?.[1]) {
        parentStocks.push(brokerMatch[1]);
      }
    } else {
      stockItems.push(item);
    }
  }
  
  return {
    stockList: stockItems.join('、'),
    warrantList: warrantItems.join('、'),
    parentStocks: [...new Set(parentStocks)],
  };
}

function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  const { stockList, warrantList, parentStocks } = classifyHoldings(stocks);
  
  // Build holdings section with clear separation
  let holdingsSection = '';
  if (stockList) {
    holdingsSection += `## 股票持倉\n${stockList}\n\n`;
  }
  if (warrantList) {
    holdingsSection += `## 權證持倉（僅需列出「到期日」事件，不需要列出營收/財報/法說/除息/股東會）\n${warrantList}\n\n`;
  }
  if (parentStocks.length > 0) {
    const existingStockCodes = stockList.match(/\d{4}/g) || [];
    const parentInfo = parentStocks.filter(p => {
      // Only add parent if not already in stock list
      return !existingStockCodes.some(code => stockList.includes(code) && stockList.includes(p));
    });
    if (parentInfo.length > 0) {
      holdingsSection += `## 權證母股（需列出營收/財報/法說/除息/股東會等事件，標明影響哪檔權證）\n${parentInfo.join('、')}（請搜尋這些公司的正確股票代碼）\n\n`;
    }
  }

  return `# Role
你是一位頂級 AI 財經分析師，精通台股市場，善於搜尋並彙整即時資訊。

# Task Objective
針對以下持倉標的，利用網路搜尋找出「${today} 的隔天起到 ${endDate}」的重要事件行事曆。

${holdingsSection}

# ⚠️ 重要：標的分類規則
- **股票**（4碼代碼）：每支股票一次搜尋，涵蓋所有類別（營收、財報、法說、除息、總經、催化、權證、操作）
- **權證**（6碼代碼，名稱含「購」「售」「牛」「熊」）：**只需列出到期日事件**（type 填「權證」），不要列出權證的營收、財報等（權證沒有這些）
- **權證母股**：如果持有的權證有對應母股，需額外搜尋母股的重要事件，並在 label 中標明「（影響權證 XXXXXX）」

# 搜尋策略
- **一股一次搜全部**：針對每支股票，一次搜尋該股所有類別的事件（例：搜尋 6139 亞翔的法說/財報/營收/催化/操作/總經/權證/除息）
- 不要按類別分開搜尋，而是按個股整合搜尋

# 事件類別（8 大類）
1. **營收**：每月營收公布（次月10日前）— 僅適用於股票
2. **財報**：季度財報公布截止日 — 僅適用於股票
3. **法說**：法說會、業績發表會 — 僅適用於股票
4. **除息**：除權息日、配息基準日 — 僅適用於股票
5. **總經**：央行會議、FOMC、CPI、GDP、非農就業等
6. **催化**：產業展覽、新品發表、重大訂單、政策利多、**股東會** — 僅適用於股票
7. **權證**：權證到期日 — 適用於權證
8. **操作**：董事會、庫藏股 — 僅適用於股票

# ⚠️ 嚴格限制
- **絕對禁止**搜尋或列出上述持倉清單以外的任何股票標的
- 只能針對上方明確列出的「股票代碼」「權證代碼」「權證母股名稱」進行搜尋
- 如果某事件與持倉標的無關，即使搜尋到也必須丟棄，不得列入結果

# 重要指引
- **即使搜尋不到精確日期，也必須列出事件**，date 欄位可用模糊表達
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

  if (!apiKey) {
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
{"date":"日期","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/權證","sources":["來源網址1","來源網址2"]}

規則：
- sources 欄位：必須填入你搜尋到該事件資訊的真實外部網址（如 https://www.twse.com.tw/...、https://mops.twse.com.tw/...、https://finance.yahoo.com/... 等），不能是 lovable.app 或 vertexaisearch 的網址。如果找不到來源，填空陣列 []。每個事件最多 3 個來源。
- date 欄位：如果有精確日期，用 YYYY/MM/DD 格式；如果只知道月份，用「2025/07月」；如果只知道季度，用「2025 Q2」；如果尚未公布，用「尚未公布」或「待確認」。總之不要因為日期不精確就省略事件。
- urgent=true 僅限未來一週內的事件（模糊日期的事件 urgent=false）
- type 只能用：法說、財報、營收、催化、操作、總經、除息、權證
- 按日期由近到遠排序，模糊日期的排在精確日期之後`;

    const prompt = buildPrompt(stocks, today, endDate, outputFormat);
    // Filter out any lovable/proxy URLs from AI-generated sources
    const cleanSources = (events: any[]) => {
      return events.map(ev => {
        if (!ev.sources || !Array.isArray(ev.sources)) return { ...ev, sources: [] };
        const cleaned = ev.sources.filter((url: string) => 
          typeof url === 'string' && 
          url.startsWith('http') && 
          !url.includes('lovable.app') && 
          !url.includes('lovable.dev') &&
          !url.includes('vertexaisearch.cloud.google.com')
        );
        return { ...ev, sources: cleaned };
      });
    };

    const okResponse = (events: any[]) => {
      const enriched = cleanSources(events);
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
          console.log(`Calendar: grounding succeeded, ${events.length} events`);
          return okResponse(events);
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
