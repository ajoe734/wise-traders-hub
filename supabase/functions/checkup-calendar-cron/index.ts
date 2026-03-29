// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGeminiWithGrounding(apiKey: string, prompt: string): Promise<{ ok: boolean; text: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
            tools: [{ google_search: {} }],
          }),
        },
      );
      if (response.status === 429 && attempt === 0) {
        console.log('Cron: Gemini 429, waiting 60s...');
        await sleep(60000);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        console.error(`Cron: Gemini failed (${response.status}):`, errText.slice(0, 300));
        return { ok: false, text: errText };
      }
      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
      if (!text) return { ok: false, text: '' };
      return { ok: true, text };
    } catch (err) {
      console.error('Cron: Gemini exception:', err);
      return { ok: false, text: String(err) };
    }
  }
  return { ok: false, text: 'retry exhausted' };
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

function tryParseEvents(text: string): any[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch {}
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  const jsonStr = extractJsonArray(cleaned);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  const jsonStr2 = extractJsonArray(text);
  if (jsonStr2 && jsonStr2 !== jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr2);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get('GEMINI_ANALYSIS_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  if (!apiKey) {
    console.log('Cron: No GEMINI_ANALYSIS_API_KEY, skipping');
    return new Response(JSON.stringify({ status: 'skipped', reason: 'no API key' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. 讀取目前持倉
    const { data: holdingsRow } = await supabase
      .from('checkup_storage')
      .select('data')
      .eq('key', 'pf-calendar-holdings')
      .maybeSingle();

    if (!holdingsRow?.data?.stocks) {
      console.log('Cron: No holdings found, skipping');
      return new Response(JSON.stringify({ status: 'skipped', reason: 'no holdings' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stocks = holdingsRow.data.stocks;
    const holdingCodes = holdingsRow.data.holdingCodes || '';

    // 2. 讀取現有行事曆事件
    const { data: calRow } = await supabase
      .from('checkup_storage')
      .select('data')
      .eq('key', 'pf-calendar-v1')
      .maybeSingle();

    const existingEvents: any[] = calRow?.data?.events || [];

    // 3. 呼叫 Gemini 取得新事件
    const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
    const oneYearLater = new Date();
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const endDate = oneYearLater.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');

    const outputFormat = `JSON陣列，每個元素格式：
{"date":"日期","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/到期","sources":[]}

規則：
- sources 給空陣列 []
- date 欄位：如果有精確日期，用 YYYY/MM/DD 格式；如果只知道月份，用「2025/07月」；如果只知道季度，用「2025 Q2」；如果尚未公布，用「尚未公布」或「待確認」。總之不要因為日期不精確就省略事件。
- urgent=true 僅限未來一週內的事件（模糊日期的事件 urgent=false）
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序，模糊日期的排在精確日期之後`;

    const prompt = `# Role
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

    const result = await callGeminiWithGrounding(apiKey, prompt);
    if (!result.ok) {
      console.error('Cron: Gemini call failed');
      return new Response(JSON.stringify({ status: 'error', reason: 'Gemini failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newEvents = tryParseEvents(result.text);
    if (!newEvents) {
      console.error('Cron: Failed to parse events');
      return new Response(JSON.stringify({ status: 'error', reason: 'parse failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. 合併去重
    const seen = new Set(existingEvents.map((e: any) => `${e.label}||${e.date}`));
    const merged = [...existingEvents];
    let addedCount = 0;
    for (const ne of newEvents) {
      if (!ne || !ne.label) continue;
      const key = `${ne.label}||${ne.date}`;
      if (!seen.has(key)) {
        merged.push(ne);
        seen.add(key);
        addedCount++;
      }
    }
    merged.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));

    // 5. 儲存回 checkup_storage
    await supabase.from('checkup_storage').upsert({
      key: 'pf-calendar-v1',
      data: { events: merged, holdingCodes },
    });

    console.log(`Cron: Done. Existing: ${existingEvents.length}, New: ${addedCount}, Total: ${merged.length}`);
    return new Response(JSON.stringify({
      status: 'ok',
      existing: existingEvents.length,
      added: addedCount,
      total: merged.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Cron error:', err);
    return new Response(JSON.stringify({ status: 'error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
