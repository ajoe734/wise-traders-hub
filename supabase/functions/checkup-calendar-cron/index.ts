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
            generationConfig: { temperature: 0.3, maxOutputTokens: 65536 },
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
      if (brokerMatch?.[1]) parentStocks.push(brokerMatch[1]);
    } else {
      stockItems.push(item);
    }
  }
  return { stockList: stockItems.join('、'), warrantList: warrantItems.join('、'), parentStocks: [...new Set(parentStocks)] };
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
{"date":"日期","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/權證","sources":["來源網址1","來源網址2"]}

規則：
- sources 欄位：必須填入你搜尋到該事件資訊的真實外部網址（如 https://www.twse.com.tw/...、https://mops.twse.com.tw/...、https://finance.yahoo.com/... 等），不能是 lovable.app 或 vertexaisearch 的網址。如果找不到來源，填空陣列 []。每個事件最多 3 個來源。
- date 欄位：如果有精確日期，用 YYYY/MM/DD 格式；如果只知道月份，用「2025/07月」；如果只知道季度，用「2025 Q2」；如果尚未公布，用「尚未公布」或「待確認」。總之不要因為日期不精確就省略事件。
- urgent=true 僅限未來一週內的事件（模糊日期的事件 urgent=false）
- type 只能用：法說、財報、營收、催化、操作、總經、除息、權證
- 按日期由近到遠排序，模糊日期的排在精確日期之後`;

    const stocksStr = typeof stocks === 'string' ? stocks : stocks.map((s: any) => `${s.code} ${s.name}`).join('、');
    const { stockList, warrantList, parentStocks } = classifyHoldings(stocksStr);
    
    let holdingsSection = '';
    if (stockList) holdingsSection += `## 股票持倉\n${stockList}\n\n`;
    if (warrantList) holdingsSection += `## 權證持倉（僅需列出「到期日」事件）\n${warrantList}\n\n`;
    if (parentStocks.length > 0) {
      holdingsSection += `## 權證母股（需列出營收/財報/法說/除息/股東會等事件，標明影響哪檔權證）\n${parentStocks.join('、')}（請搜尋正確股票代碼）\n\n`;
    }

    const prompt = `# Role
你是一位頂級 AI 財經分析師，精通台股市場，善於搜尋並彙整即時資訊。

# Task Objective
針對以下持倉標的，利用網路搜尋找出「${today} 的隔天起到 ${endDate}」的重要事件行事曆。

${holdingsSection}

# ⚠️ 重要：標的分類規則
- **股票**（4碼代碼）：列出全部 8 大類事件
- **權證**（6碼代碼）：**只需列出到期日事件**（type 填「權證」）
- **權證母股**：搜尋母股的重要事件，在 label 中標明「（影響權證 XXXXXX）」

# 事件類別（8 大類）
1. **營收**：每月營收公布（次月10日前）— 僅適用於股票
2. **財報**：季度財報公布截止日 — 僅適用於股票
3. **法說**：法說會、業績發表會 — 僅適用於股票
4. **除息**：除權息日、配息基準日 — 僅適用於股票
5. **總經**：央行會議、FOMC、CPI、GDP、非農就業等
6. **催化**：產業展覽、新品發表、重大訂單、政策利多
7. **權證**：權證到期日 — 適用於權證
8. **操作**：股東會、董事會、庫藏股 — 僅適用於股票

# ⚠️ 嚴格限制
- **絕對禁止**搜尋或列出上述持倉清單以外的任何股票標的
- 只能針對上方明確列出的「股票代碼」「權證代碼」「權證母股名稱」進行搜尋
- 如果某事件與持倉標的無關，即使搜尋到也必須丟棄，不得列入結果

# 重要指引
- **即使搜尋不到精確日期，也必須列出事件**
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

    console.log(`Cron: Calendar done. Existing: ${existingEvents.length}, New: ${addedCount}, Total: ${merged.length}`);

    // ── 6. 自動預測 7 天內的 pending 事件 ──
    let predictedCount = 0;
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const sevenDaysLater = new Date(now);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

      // 同時讀取 newsEvents (pf-news-events-v1)
      const { data: newsRow } = await supabase
        .from('checkup_storage')
        .select('data')
        .eq('key', 'pf-news-events-v1')
        .maybeSingle();

      const newsEvents: any[] = newsRow?.data || [];

      const needsPrediction = newsEvents.filter((e: any) => {
        if (e.status !== 'pending') return false;
        if (!e.date || !e.date.match(/^\d{4}\/\d{2}\/\d{2}/)) return false;
        const evDate = new Date(e.date.replace(/\//g, '-'));
        evDate.setHours(0, 0, 0, 0);
        return evDate >= now && evDate <= sevenDaysLater;
      });

      if (needsPrediction.length > 0) {
        console.log(`Cron: Found ${needsPrediction.length} events needing prediction`);

        // 呼叫 checkup-predict-events edge function
        const predictRes = await fetch(`${supabaseUrl}/functions/v1/checkup-predict-events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            events: needsPrediction.map((e: any, i: number) => ({
              index: i + 1,
              date: e.date,
              title: e.title || e.label,
              detail: e.detail || e.sub || '',
              stocks: e.stocks || [],
            })),
            holdings: stocks.map((s: any) => ({
              code: s.code,
              name: s.name,
              costPrice: s.costPrice,
              marketPrice: s.marketPrice,
            })),
          }),
        });

        if (predictRes.ok) {
          const predData = await predictRes.json();
          const preds = predData.predictions || [];

          // 更新 newsEvents 中對應事件的狀態
          const updatedNews = [...newsEvents];
          needsPrediction.forEach((e: any, i: number) => {
            const idx = updatedNews.findIndex((x: any) => x.id === e.id);
            if (idx < 0) return;
            const p = preds.find((pp: any) => pp.index === i + 1);
            updatedNews[idx] = {
              ...updatedNews[idx],
              status: 'verifying',
              pred: p?.pred || 'neutral',
              predReason: p?.predReason || 'AI 自動預測（Cron）',
            };
            predictedCount++;
          });

          // 儲存回 checkup_storage
          await supabase.from('checkup_storage').upsert({
            key: 'pf-news-events-v1',
            data: updatedNews,
          });

          console.log(`Cron: Predicted ${predictedCount} events`);
        } else {
          const errText = await predictRes.text();
          console.error(`Cron: Predict call failed (${predictRes.status}):`, errText.slice(0, 200));
        }
      } else {
        console.log('Cron: No pending events in 7-day window');
      }
    } catch (predErr) {
      console.error('Cron: Prediction step error:', predErr);
    }

    return new Response(JSON.stringify({
      status: 'ok',
      existing: existingEvents.length,
      added: addedCount,
      total: merged.length,
      predicted: predictedCount,
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
