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
你是一位頂級 AI 財經分析師，精通台股市場。

# Task Objective
針對以下持倉標的，列出「${today} 的隔天起到 ${endDate}」之間所有重要事件。

持倉標的：${stocks}

# 事件類型（全部都要涵蓋）
請根據你的訓練知識，盡可能完整列出以下類型的事件：
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
- 數量不限：只要是有價值的事件就列出，不要自我限制數量
- 過濾垃圾：移除廣告、無關評論、情緒性廢話、重複事件
- 禁止幻覺：若無具體依據，不要編造事件
- 不要包含今天(${today})或過去的事件
- 每檔標的至少列出月營收和季度財報相關事件

# Output Format
只輸出純 JSON 陣列，不輸出其他任何文字（不要 markdown code block）：
${outputFormat}`;
}

// ===== Validate response has meaningful events =====
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
- sources 若無來源可給空陣列 []
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
        const result = await callModel(openrouterKey, model, messages, 0.4);
        if (result.ok && result.text) {
          if (hasValidEvents(result.text)) {
            console.log(`Calendar: ${model} succeeded with valid events`);
            return new Response(JSON.stringify({ text: result.text, response: result.text }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          console.warn(`Calendar: ${model} returned empty/invalid events, trying next...`);
          errors.push(`${model}(empty)`);
          continue;
        }
        errors.push(`${model}(${result.status})`);
        console.warn(`Calendar: ${model} failed (${result.status}), trying next...`);
      }
    }

    // ===== 第二層：Lovable AI Gateway (Gemini 一條龍) =====
    if (lovableKey) {
      console.log('Calendar: all OpenRouter models failed, trying Lovable AI Gateway...');
      const result = await callLovableAI(lovableKey, messages, 0.4);
      if (result.ok && result.text) {
        console.log('Calendar: Lovable AI Gateway succeeded');
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
