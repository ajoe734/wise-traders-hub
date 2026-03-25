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
你是一位頂級 AI 財經分析師，精通台股市場行事曆與事件排程。

# Task Objective
針對以下持倉標的，列出「${today} 的隔天起到 ${endDate}」之間所有重要事件。

持倉標的：${stocks}

# 重要：你必須利用你的訓練知識來推算固定行程事件

台股有許多**固定規律**的事件，你必須根據這些規律為每檔持倉標的列出事件：

## 固定行程規律（必須列出）
1. **月營收公布**：台灣上市櫃公司每月營收必須在次月10日前公布。例如：3月營收在4/10前公布，以此類推，請為未來12個月都列出。
2. **季度財報**：
   - Q1 財報：5/15 前公布
   - Q2 財報（半年報）：8/14 前公布
   - Q3 財報：11/14 前公布
   - Q4 財報（年報）：隔年 3/31 前公布
3. **股東會旺季**：通常集中在每年 5-6 月
4. **除權息旺季**：通常集中在每年 6-9 月
5. **法說會**：上市櫃公司通常在財報公布後舉辦法說會

## 權證特別注意
- 權證代碼通常為 6 碼（如 039108、053848），名稱含「購」「售」「牛」「熊」
- 權證有到期日，必須列出。根據權證名稱中的資訊推算（例如名稱含券商與期別）
- 同時列出母股（標的股）的重要事件，標明影響哪檔權證

## ETF 特別注意
- 配息日、除息日、成分股調整（通常季度調整）

## 總經事件
- 台灣央行理監事會議（通常每季一次：3月、6月、9月、12月）
- 美國 FOMC 會議、CPI 公布等影響台股的重大總經事件
- 台灣 CPI、GDP 公布日

# Processing Pipeline
1. **廣泛列舉**：根據上述固定規律，為每檔持倉標的生成未來12個月的所有已知/可推算事件
2. **深度提取**：補充你所知的具體財務數據（EPS、毛利率、營收趨勢等）
3. **邏輯去重**：合併重複事件，保留資訊最齊全的版本
4. **精煉輸出**：轉化為指定 JSON 格式

# Constraints
- 固定行程事件（月營收、季度財報、央行會議等）是**確定會發生的**，必須列出，這不算幻覺
- 對於不確定具體日期的事件，使用該事件的法定截止日作為日期（如月營收用次月10日）
- 移除廣告和無關評論
- 來源網址：固定行程事件可以給空陣列 []，因為這些是法規規定的既定行程
- 不要包含今天(${today})或過去的事件
- 事件數量不限，每檔標的至少要有月營收和季度財報事件

# Output Format
只輸出純 JSON 陣列，不輸出其他任何文字（不要 markdown code block）：
${outputFormat}`;
}

// ===== Validate response has meaningful events =====
function hasValidEvents(text: string): boolean {
  try {
    // Extract JSON from potential markdown code blocks
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
- sources 若為固定行程事件可給空陣列 []
- date 必須用 YYYY/MM/DD 格式
- urgent=true 僅限未來一週內的事件
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序
- 每檔標的至少要列出月營收公布日和季度財報截止日`;

    const prompt = buildPrompt(stocks, today, endDate, outputFormat);
    const messages = [{ role: 'user', content: prompt }];
    const errors: string[] = [];

    // ===== 第一層：OpenRouter 模型鏈 =====
    if (openrouterKey) {
      for (const model of MODEL_CHAIN) {
        console.log(`Calendar: trying ${model}...`);
        const result = await callModel(openrouterKey, model, messages, 0.4);
        if (result.ok && result.text) {
          // 驗證回應是否有有效事件（非空陣列）
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
      console.log('Calendar: all OpenRouter models failed or returned empty, trying Lovable AI Gateway...');
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
