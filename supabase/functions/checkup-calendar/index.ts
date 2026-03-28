// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MODELS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
];

async function callLovableAI(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: 4096,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Lovable AI ${model} failed (${response.status}):`, errText);
      return { ok: false, text: errText, status: response.status };
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) {
      console.error(`Lovable AI ${model} returned empty content`);
      return { ok: false, text: '', status: 200 };
    }
    return { ok: true, text, status: 200 };
  } catch (err) {
    console.error(`Lovable AI ${model} exception:`, err);
    return { ok: false, text: String(err), status: 500 };
  }
}

function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  return `# Role
你是一位整合了搜尋力、長文本解析、邏輯去重與精煉輸出優點的頂級 AI 財經分析師，精通台股市場。

# Task Objective
針對以下持倉標的，執行「${today} 的隔天起到 ${endDate}」的持倉股票情報清洗與精煉。

持倉標的：${stocks}

# Processing Pipeline (請按順序執行)

## 階段 1：廣泛過濾
識別並鎖定發生在「${today} 的隔天起到 ${endDate}」的所有事件，涵蓋以下 8 大類：
- **營收**：每月營收公布（次月10日前）
- **財報**：季度財報公布截止日
- **法說**：法說會、業績發表會
- **除息**：除權息日、配息基準日
- **總經**：央行會議、FOMC、CPI、GDP 等影響台股的重大事件
- **催化**：產業展覽、新品發表、大客戶訂單、技術突破、政策利多
- **到期**：權證到期日（權證代碼通常為6碼，名稱含「購」「售」「牛」「熊」）
- **操作**：股東會、董事會、庫藏股、大股東申報轉讓

## 階段 2：深度提取
從混亂文本中摳出：EPS、毛利率、營收成長率、大客戶訂單、技術突破、地緣政治風險等關鍵資訊。

## 階段 3：邏輯去重 (Critical)
若內容本質相同（如：僅標題微調、轉載自同一社論、或同一事件的後續小追蹤），僅保留「最原始」或「資訊最齊全」的一則，嚴禁重複顯示同一事件。

## 階段 4：精煉輸出
將去重後的乾貨轉化為指定的 JSON 格式。

# 重要指引
- 權證標的：同時列出其母股（標的股）的重要事件，標明影響哪檔權證
- 數量不限：只要是有價值的事件就列出，不要自我限制數量
- 每檔標的至少列出月營收和季度財報相關事件
- 過濾垃圾：移除廣告、無關評論、情緒性廢話
- 禁止幻覺：若無具體依據，不要編造事件
- 不要包含今天(${today})或過去的事件

# Constraints
- 嚴禁「幻覺」：若文中無具體數據，不採納
- 移除所有廣告、無關的市場評論或情緒性廢話

# Output Format
只輸出純 JSON 陣列，不輸出其他任何文字（不要 markdown code block）：
${outputFormat}`;
}

function hasValidEvents(text: string): boolean {
  try {
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
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

  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY is not configured' }), {
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
{"date":"YYYY/MM/DD","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/到期","sources":["來源網址1","來源網址2"]}

規則：
- 不輸出 pred、predReason 等預判欄位
- sources 若無來源可給空陣列 []
- date 必須用 YYYY/MM/DD 格式
- urgent=true 僅限未來一週內的事件
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序`;

    const prompt = buildPrompt(stocks, today, endDate, outputFormat);
    const errors: string[] = [];

    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i];
      console.log(`Calendar: trying Lovable AI ${model} (${i + 1}/${MODELS.length})`);

      const result = await callLovableAI(apiKey, model, prompt, 0.4);

      if (result.ok && result.text) {
        if (hasValidEvents(result.text)) {
          console.log(`Calendar: Lovable AI ${model} succeeded`);
          return new Response(JSON.stringify({ text: result.text, response: result.text }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        errors.push(`${model}(empty)`);
        continue;
      }

      if (result.status === 402 || result.status === 429) {
        return new Response(JSON.stringify({ error: 'AI 額度已用完，請稍後再試' }), {
          status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      errors.push(`${model}(${result.status})`);
    }

    return new Response(JSON.stringify({
      error: '行事曆產生失敗，所有模型均無法使用',
      detail: errors.join(', '),
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
