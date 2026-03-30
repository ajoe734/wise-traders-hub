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

// ── 靜態總經事件（不走 AI 搜尋） ──
function generateMacroEvents(todayStr: string, endDateStr: string): any[] {
  const today = new Date(todayStr.replace(/\//g, '-'));
  const endDate = new Date(endDateStr.replace(/\//g, '-'));
  const events: any[] = [];

  // Helper: add event if within range
  const addIfInRange = (dateStr: string, label: string, sub: string) => {
    const d = new Date(dateStr);
    if (d > today && d <= endDate) {
      const formatted = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      const diffDays = Math.ceil((d.getTime() - today.getTime()) / 86400000);
      events.push({ date: formatted, label, sub, urgent: diffDays <= 7, type: '總經', sources: [] });
    }
  };

  // Generate events for the range year(s)
  const startYear = today.getFullYear();
  const endYear = endDate.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    // FOMC 會議（通常 8 次/年，以下為典型排程）
    const fomcDates = [
      `${year}-01-29`, `${year}-03-19`, `${year}-05-07`, `${year}-06-18`,
      `${year}-07-30`, `${year}-09-17`, `${year}-11-05`, `${year}-12-17`,
    ];
    fomcDates.forEach(d => addIfInRange(d, `FOMC 利率決議 (${year})`, '美國聯準會利率決策會議'));

    // 台灣央行理監事會（每季一次：3月、6月、9月、12月）
    const cbcDates = [`${year}-03-20`, `${year}-06-19`, `${year}-09-18`, `${year}-12-18`];
    cbcDates.forEach(d => addIfInRange(d, `台灣央行理監事會 (${year})`, '央行利率決策'));

    // 美國 CPI（每月中旬公布）
    for (let m = 1; m <= 12; m++) {
      addIfInRange(`${year}-${String(m).padStart(2, '0')}-13`, `美國 CPI 公布 (${year}/${String(m).padStart(2, '0')})`, '消費者物價指數');
    }

    // 美國非農就業（每月第一個週五，近似為每月第一週）
    for (let m = 1; m <= 12; m++) {
      const firstDay = new Date(year, m - 1, 1);
      const dayOfWeek = firstDay.getDay();
      const firstFriday = dayOfWeek <= 5 ? (5 - dayOfWeek + 1) : (12 - dayOfWeek + 1);
      addIfInRange(`${year}-${String(m).padStart(2, '0')}-${String(firstFriday).padStart(2, '0')}`, `美國非農就業 (${year}/${String(m).padStart(2, '0')})`, '就業數據');
    }

    // 台灣 GDP（每季公布：1月、4月、7月、10月底）
    const gdpDates = [`${year}-01-30`, `${year}-04-30`, `${year}-07-31`, `${year}-10-31`];
    gdpDates.forEach((d, i) => addIfInRange(d, `台灣 GDP 初估 (${year} Q${i + 1})`, '國內生產毛額'));

    // 台股財報截止日
    addIfInRange(`${year}-03-31`, `Q4 財報截止日 (${year - 1})`, '年度財報申報截止');
    addIfInRange(`${year}-05-15`, `Q1 財報截止日 (${year})`, '第一季財報申報截止');
    addIfInRange(`${year}-08-14`, `Q2 財報截止日 (${year})`, '第二季財報申報截止');
    addIfInRange(`${year}-11-14`, `Q3 財報截止日 (${year})`, '第三季財報申報截止');

    // 台股月營收公布截止日（次月 10 日前）
    for (let m = 1; m <= 12; m++) {
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? year + 1 : year;
      addIfInRange(`${nextYear}-${String(nextMonth).padStart(2, '0')}-10`, `${m}月營收公布截止 (${year})`, '上市櫃公司月營收申報截止');
    }
  }

  return events;
}

// ── 權證到期日查詢（不用 Grounding，用 Plain JSON） ──
async function fetchWarrantExpiry(apiKey: string, warrantList: string): Promise<any[]> {
  if (!warrantList) return [];
  const prompt = `你是台股權證專家。以下是權證清單，請查出每檔權證的到期日。

權證清單：${warrantList}

輸出 JSON 陣列：
[{"date":"YYYY/MM/DD","label":"權證名稱 到期日","sub":"到期日","urgent":false,"type":"權證","sources":[]}]

只輸出 JSON 陣列。`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!response.ok) {
      console.error(`Warrant expiry fetch failed (${response.status})`);
      return [];
    }
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text ?? '').join('').trim();
    const parsed = tryParseEvents(text);
    if (parsed) {
      console.log(`Warrant expiry: found ${parsed.length} events`);
      return parsed.map(e => ({ ...e, type: '權證' }));
    }
  } catch (err) {
    console.error('Warrant expiry error:', err);
  }
  return [];
}

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
        const chunks = groundingMeta.groundingChunks || [];
        for (const chunk of chunks) {
          const uri = chunk?.web?.uri;
          const title = chunk?.web?.title || '';
          if (uri) {
            if (uri.includes('vertexaisearch.cloud.google.com')) {
              if (title && !title.includes('lovable')) {
                groundingSources.push(title.startsWith('http') ? title : `https://${title}`);
              }
            } else if (!uri.includes('lovable.app') && !uri.includes('lovable.dev')) {
              groundingSources.push(uri);
            }
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
  const start = text.indexOf('[');
  if (start === -1) return null;
  const sub = text.substring(start);
  const lastCompleteObj = sub.lastIndexOf('}');
  if (lastCompleteObj === -1) return null;
  const candidate = sub.substring(0, lastCompleteObj + 1) + ']';
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  const trimmed = candidate.replace(/,\s*\]$/, ']');
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  return null;
}

function tryParseEvents(text: string): any[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch { /* not pure JSON */ }

  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');

  const jsonStr = extractJsonArray(cleaned);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }

  const jsonStr2 = extractJsonArray(text);
  if (jsonStr2 && jsonStr2 !== jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr2);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }

  const repaired = tryRepairTruncatedArray(cleaned);
  if (repaired) {
    console.log(`Calendar: repaired truncated JSON, recovered ${repaired.length} events`);
    return repaired;
  }

  return null;
}

function classifyHoldings(stocks: string): { stockList: string; warrantList: string; parentStocks: string[] } {
  const items = stocks.split(/[、,]/).map(s => s.trim()).filter(Boolean);
  const stockItems: string[] = [];
  const warrantItems: string[] = [];
  const parentStocks: string[] = [];

  for (const item of items) {
    const code = item.match(/^(\d+)/)?.[1] || '';
    const name = item.replace(/^\d+\s*/, '');
    const isWarrant = code.length === 6 || /[購售牛熊]/.test(name);
    if (isWarrant) {
      warrantItems.push(item);
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

// ── 優化後的 Prompt：合併搜尋 + 母股只搜 3 大類 + 不含總經/權證到期 ──
function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  const { stockList, warrantList, parentStocks } = classifyHoldings(stocks);

  let holdingsSection = '';
  if (stockList) {
    holdingsSection += `## 股票持倉（每檔一次搜尋所有事件類別）\n${stockList}\n\n`;
  }
  if (parentStocks.length > 0) {
    const existingStockCodes = stockList.match(/\d{4}/g) || [];
    const parentInfo = parentStocks.filter(p => {
      return !existingStockCodes.some(code => stockList.includes(code) && stockList.includes(p));
    });
    if (parentInfo.length > 0) {
      holdingsSection += `## 權證母股（僅搜尋營收、法說、除息三大類，標明影響哪檔權證）\n${parentInfo.join('、')}（請搜尋這些公司的正確股票代碼）\n\n`;
    }
  }

  // If no stocks to search with grounding, return empty
  if (!holdingsSection) return '';

  return `# Role
你是台股財經分析師，精通台股市場。

# Task
針對以下持倉標的，搜尋「${today} 隔天起到 ${endDate}」的重要事件。

${holdingsSection}

# 搜尋策略（重要！請遵守以節省搜尋次數）
- **每檔股票只搜尋一次**，一次涵蓋所有事件類別（法說、除息、催化、操作）
- 搜尋關鍵字範例：「6139 亞翔 2026 法說會 除息 股東會」（一次搜完）
- **不要搜尋「營收」和「財報」**，這些已由系統自動產生
- **不要搜尋「總經」事件**（FOMC/CPI/GDP/非農），已由系統自動產生
- **不要搜尋「權證到期日」**，已由系統另外處理

# 股票事件類別（4 類）
1. **法說**：法說會、業績發表會
2. **除息**：除權息日、配息基準日
3. **催化**：產業展覽、新品發表、重大訂單、政策利多
4. **操作**：股東會、董事會、庫藏股

# 母股事件類別（3 類）
1. **法說**：法說會
2. **除息**：除權息日
3. **營收**：重大營收變化（僅限母股）

# ⚠️ 嚴格限制
- **絕對禁止**搜尋持倉清單以外的任何標的
- **即使搜尋不到精確日期，也必須列出事件**，date 可用模糊表達
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
{"date":"日期","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/催化/操作/除息/營收","sources":["來源網址1"]}

規則：
- sources：填入真實外部網址，不能是 lovable.app 或 vertexaisearch。找不到填 []。最多 2 個。
- date：精確日期用 YYYY/MM/DD；只知月份用「2026/07月」；只知季度用「2026 Q2」；未公布用「待確認」
- urgent=true 僅限未來一週內事件
- type 只能用：法說、催化、操作、除息、營收
- 按日期由近到遠排序`;

    // ── 並行執行三個任務 ──
    const { warrantList } = classifyHoldings(stocks);

    // 1. 靜態總經事件（即時）
    const macroEvents = generateMacroEvents(today, endDate);
    console.log(`Calendar: generated ${macroEvents.length} static macro events`);

    // 2. 權證到期日（不用 Grounding，用 flash-lite）
    const warrantPromise = fetchWarrantExpiry(apiKey, warrantList);

    // 3. 股票事件（用 Grounding）
    const prompt = buildPrompt(stocks, today, endDate, outputFormat);

    let stockEvents: any[] = [];
    if (prompt) {
      const model = 'gemini-2.5-flash';
      console.log(`Calendar: calling ${model} WITH grounding (optimized prompt)`);
      const result = await callGeminiWithGrounding(apiKey, model, prompt, 0.3);

      if (result.ok && result.text) {
        const events = tryParseEvents(result.text);
        if (events) {
          console.log(`Calendar: grounding succeeded, ${events.length} stock events`);
          stockEvents = events;
        } else {
          console.error(`Calendar: grounding parse failed. First 500:`, result.text.slice(0, 500));
        }
      }

      // Fallback: plain mode
      if (stockEvents.length === 0 && result.status !== 429) {
        console.log(`Calendar: fallback to ${model} WITHOUT grounding`);
        const fallback = await callGeminiPlain(apiKey, model, prompt, 0.3);
        if (fallback.ok && fallback.text) {
          const events = tryParseEvents(fallback.text);
          if (events) {
            console.log(`Calendar: plain succeeded, ${events.length} stock events`);
            stockEvents = events;
          }
        }
      }
    }

    // 等待權證到期日結果
    const warrantEvents = await warrantPromise;
    console.log(`Calendar: ${warrantEvents.length} warrant events`);

    // ── 合併所有事件 ──
    const allEvents = [...stockEvents, ...warrantEvents, ...macroEvents];

    // 清理 sources
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

    // 去重（label + date）
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const ev of cleanSources(allEvents)) {
      const key = `${ev.label}||${ev.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(ev);
      }
    }

    // 排序
    deduped.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    console.log(`Calendar: total ${deduped.length} events (stock:${stockEvents.length} warrant:${warrantEvents.length} macro:${macroEvents.length})`);

    if (deduped.length === 0 && stockEvents.length === 0) {
      return new Response(JSON.stringify({ error: '行事曆產生失敗，所有模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ text: JSON.stringify(deduped), response: JSON.stringify(deduped) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('Calendar error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '行事曆產生失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
