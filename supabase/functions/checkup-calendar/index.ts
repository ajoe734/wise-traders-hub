// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// 單一模型 fallback 清單（按搜尋+篩選金融資訊能力排序）
const MODEL_CHAIN = [
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "stepfun/step-3.5-flash:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "openai/gpt-oss-120b:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
];

// ===== OpenRouter model caller =====
async function callModel(
  apiKey: string,
  model: string,
  messages: any[],
  temperature: number,
): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wise-traders-hub.lovable.app',
        'X-Title': 'WiseTraders Calendar',
      },
      body: JSON.stringify({ model, messages, temperature }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Model ${model} failed (${response.status}):`, errText);
      return { ok: false, text: errText, status: response.status };
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) {
      console.error(`Model ${model} returned empty content`);
      return { ok: false, text: '', status: 200 };
    }
    return { ok: true, text, status: 200 };
  } catch (err) {
    console.error(`Model ${model} exception:`, err);
    return { ok: false, text: String(err), status: 500 };
  }
}

// ===== Lovable AI Gateway caller =====
async function callLovableAI(
  apiKey: string,
  messages: any[],
  temperature: number,
): Promise<{ ok: boolean; text: string; status: number }> {
  const MODELS = ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"];
  for (const model of MODELS) {
    try {
      console.log(`Lovable AI Gateway: trying ${model}...`);
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature }),
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error(`Lovable AI (${model}) failed (${response.status}):`, errText);
        continue;
      }
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) {
        console.error(`Lovable AI (${model}) returned empty content`);
        continue;
      }
      console.log(`Lovable AI (${model}) succeeded`);
      return { ok: true, text, status: 200 };
    } catch (err) {
      console.error(`Lovable AI (${model}) exception:`, err);
    }
  }
  return { ok: false, text: '', status: 500 };
}

// ===== Build combined prompt =====
function buildPrompt(stocks: string, today: string, endDate: string, outputFormat: string): string {
  return `# Role
你是一位整合了搜尋力、長文本解析、邏輯去重與精煉輸出優點的頂級 AI 財經分析師。

# Task Objective
針對以下持倉標的，執行「${today} 的隔天起到 ${endDate}」的情報清洗與精煉。

持倉標的：${stocks}

# Processing Pipeline
請依序完成以下四個步驟：

## Step 1 — 廣泛過濾
識別並鎖定發生在「${today} 的隔天起到 ${endDate}」的所有重要事件。
- 包含所有類型的標的：普通股、權證、ETF 等
- 不要包含今天(${today})或過去的事件
- 普通股：法說會、財報公布日、除息日、月營收公布日、重大訂單、技術突破等
- 權證：列出母股的重要事件，標明影響哪檔權證，以及權證到期日
- ETF：配息日、成分股調整等
- 總經事件：央行利率決議、CPI公布等影響持股的總經數據
- 嚴禁「幻覺」：若不確定事件日期，寧可不列也絕對不要編造
- 盡可能多列出已確定日期的事件（每月營收公布、季度財報等固定行程也要列）

## Step 2 — 深度提取
從混亂文本中摳出關鍵財務數據：
- EPS、毛利率、營收成長率等具體數據
- 大客戶訂單、技術突破等催化事件
- 地緣政治風險或產業風險
- 保留所有來源網址

## Step 3 — 邏輯去重 (Critical)
請檢查事件列表。若內容本質相同（如：僅標題微調、轉載自同一社論、或同一事件的後續小追蹤），請僅保留「最原始」或「資訊最齊全」的一則，嚴禁重複顯示同一事件。合併時合併來源網址。

## Step 4 — 精煉輸出
將去重後的乾貨轉化為以下 JSON 格式。

# Constraints
- 嚴禁「幻覺」：若文中無具體數據，不採納，不編造
- 移除所有廣告、無關市場評論與情緒性廢話
- 每筆事件都要附來源網址（原始新聞/財報/公告），若無網址則給空陣列
- 不要包含今天(${today})或過去的事件
- 事件數量不限，只要是「有用」的真實事件都列出

# Output Format
只輸出純 JSON 陣列，不輸出其他任何文字（不要 markdown code block）：
${outputFormat}`;
}

// ===== Main handler =====
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');

  if (!openrouterKey && !lovableKey) {
    return new Response(JSON.stringify({ error: 'No API keys configured' }), {
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
- sources 必須是真實的原始來源網址
- date 必須用 YYYY/MM/DD 格式
- urgent=true 僅限未來一週內的事件
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序`;

    const prompt = buildPrompt(stocks, today, endDate, outputFormat);
    const messages = [{ role: 'user', content: prompt }];
    const errors: string[] = [];

    // ===== 第一層：OpenRouter 模型鏈 =====
    if (openrouterKey) {
      for (const model of MODEL_CHAIN) {
        console.log(`Calendar: trying ${model}...`);
        const result = await callModel(openrouterKey, model, messages, 0.3);
        if (result.ok && result.text) {
          console.log(`Calendar: ${model} succeeded`);
          return new Response(JSON.stringify({ text: result.text, response: result.text }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        errors.push(`${model}(${result.status})`);
        console.warn(`Calendar: ${model} failed (${result.status}), trying next...`);
      }
    }

    // ===== 第二層：Lovable AI Gateway (Gemini 一條龍) =====
    if (lovableKey) {
      console.log('Calendar: all OpenRouter models failed, trying Lovable AI Gateway...');
      const result = await callLovableAI(lovableKey, messages, 0.3);
      if (result.ok && result.text) {
        return new Response(JSON.stringify({ text: result.text, response: result.text }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      errors.push(`lovable-ai(${result.status})`);
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
