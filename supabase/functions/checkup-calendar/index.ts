// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// 4-stage pipeline models (主流程只跑你指定的四個模型)
const STAGE_MODELS = {
  stage1: ["qwen/qwen3.5-plus:free"],
  stage2: ["google/gemini-3-flash:free"],
  stage3: ["meta-llama/llama-4-maverick:free"],
  stage4: ["google/gemma-3-27b:free"],
};

async function callStage(
  apiKey: string,
  stageName: string,
  models: string[],
  messages: any[],
  temperature: number,
): Promise<{ ok: boolean; text: string; status: number; errors: string[] }> {
  const errors: string[] = [];

  for (const model of models) {
    console.log(`${stageName}: trying ${model}...`);
    const result = await callModel(apiKey, model, messages, temperature);
    if (result.ok && result.text) {
      console.log(`${stageName}: ${model} succeeded`);
      return { ok: true, text: result.text, status: 200, errors };
    }

    errors.push(`${model}(${result.status})`);
    console.warn(`${stageName}: ${model} failed (status ${result.status}), trying next...`);
  }

  console.error(`${stageName}: all models exhausted`, errors);
  return { ok: false, text: '', status: 500, errors };
}

async function callModel(apiKey: string, model: string, messages: any[], temperature: number): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wise-traders-hub.lovable.app',
        'X-Title': 'WiseTraders Calendar',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 4096,
      }),
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { stocks, today, endDate } = body;
    // stocks: "2330 台積電、03910 某權證" etc.

    if (!stocks) {
      return new Response(JSON.stringify({ error: 'Missing stocks parameter' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const outputFormat = `JSON陣列，每個元素格式：
{"date":"YYYY/MM/DD","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/到期","sources":["來源網址1","來源網址2"]}

規則：
- 不輸出 pred、predReason 等預判欄位，預判由事件分析階段處理
- sources 必須是你引用的原始新聞/財報/公告的真實網址
- date 必須用 YYYY/MM/DD 格式
- urgent=true 僅限未來一週內的事件
- type 只能用：法說、財報、營收、催化、操作、總經、除息、到期
- 按日期由近到遠排序
- 數量不限，但必須是「有用」的真實事件，不確定的寧可不列`;

    // ===== Stage 1: 廣泛過濾 =====
    const stage1Prompt = `# Role
你是一位整合了 Qwen(搜尋力)、Gemini(長文本解析)、Llama(邏輯去重) 與 Gemma(精煉輸出) 優點的頂級 AI 財經分析師。

# Task
針對以下持倉標的，蒐集從 ${today} 的隔天起到 ${endDate} 為止（未來一整年）的所有重要事件。

持倉標的：${stocks}

# Instructions
- 包含所有類型的標的：普通股、權證、ETF 等
- 不要包含今天(${today})或過去的事件
- 普通股：法說會、財報公布日、除息日、月營收公布日、重大訂單、技術突破等
- 權證：列出母股的重要事件，標明影響哪檔權證，以及權證到期日
- ETF：配息日、成分股調整等
- 總經事件：央行利率決議、CPI公布等影響持股的總經數據
- 嚴禁「幻覺」：若不確定事件日期，寧可不列也絕對不要編造
- 每個事件必須附上你引用的原始新聞/財報/公告的來源網址（sources）

以純文字列表形式輸出，每個事件包含：日期、標題、說明、類型、來源網址。`;

    const s1 = await callStage(apiKey, 'Stage1-廣泛過濾', STAGE_MODELS.stage1, [
      { role: 'user', content: stage1Prompt }
    ], 0.3);

    if (!s1.ok) {
      console.warn(`Stage 1 failed, falling back...`);
      return await fallbackSingleModel(apiKey, stocks, today, endDate, outputFormat);
    }

    // ===== Stage 2: 深度提取 =====
    const stage2Prompt = `# Role
你是一位整合了 Gemini(長文本解析) 優點的深度財報分析師。

# Task
從以下蒐集到的原始事件資料中，深度提取關鍵財務數據。

# 原始資料
${s1.text}

# Instructions
對每個事件，提取並補充：
- EPS、毛利率、營收成長率等具體數據（若資料中有的話）
- 大客戶訂單、技術突破等催化事件的具體內容
- 地緣政治風險或產業風險
- 保留所有來源網址

嚴禁「幻覺」：若文中無具體數據，不採納，不編造。
移除所有廣告、無關的市場評論或情緒性廢話。

以純文字列表形式輸出提取後的結果。`;

    const s2 = await callStage(apiKey, 'Stage2-深度提取', STAGE_MODELS.stage2, [
      { role: 'user', content: stage2Prompt }
    ], 0.3);

    const stage2Output = s2.ok ? s2.text : s1.text;

    // ===== Stage 3: 邏輯去重 =====
    const stage3Prompt = `# Role
你是一位邏輯去重專家。

# Task
請檢查以下事件列表。若內容本質相同（如：僅標題微調、轉載自同一社論、或同一事件的後續小追蹤），請僅保留「最原始」或「資訊最齊全」的一則，嚴禁重複顯示同一事件。

# 事件列表
${stage2Output}

# Instructions
- 合併重複事件，保留最完整的版本
- 保留所有來源網址（合併重複事件時合併來源）
- 以純文字列表形式輸出去重後的結果`;

    const s3 = await callStage(apiKey, 'Stage3-邏輯去重', STAGE_MODELS.stage3, [
      { role: 'user', content: stage3Prompt }
    ], 0.2);

    const stage3Output = s3.ok ? s3.text : stage2Output;

    // ===== Stage 4: 精煉輸出 =====
    const stage4Prompt = `# Role
你是一位精煉輸出專家。

# Task
將以下去重後的事件資料，轉化為嚴格的 JSON 格式輸出。

# 去重後的事件資料
${stage3Output}

# Output Format
只輸出 JSON 陣列，不輸出其他任何文字（不要 markdown code block）：
${outputFormat}

# 重要
- 只輸出純 JSON 陣列，開頭是 [，結尾是 ]
- 不要輸出 \`\`\`json 等標記
- sources 欄位必須包含真實的來源網址，若無網址則給空陣列 []`;

    const s4 = await callStage(apiKey, 'Stage4-精煉輸出', STAGE_MODELS.stage4, [
      { role: 'user', content: stage4Prompt }
    ], 0.2);

    if (s4.ok && s4.text) {
      console.log(`4-stage pipeline complete.`);
      return new Response(JSON.stringify({
        text: s4.text,
        response: s4.text,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.warn(`Stage 4 failed, falling back...`);
    return await fallbackSingleModel(apiKey, stocks, today, endDate, outputFormat);

  } catch (err) {
    console.error('Calendar pipeline error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '行事曆產生失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function fallbackSingleModel(apiKey: string, stocks: string, today: string, endDate: string, outputFormat: string) {
  // Gemini 一條龍：把原本 4 階段的 prompt 全部合併成一個
  const combinedPrompt = `# Role
你是一位整合了 Qwen(搜尋力)、Gemini(長文本解析)、Llama(邏輯去重) 與 Gemma(精煉輸出) 優點的頂級 AI 財經分析師。

# Task Objective
針對以下原始數據，執行「扣除當天的未來一年」的持倉股票情報清洗與精煉。

持倉標的：${stocks}
時間範圍：${today} 的隔天起到 ${endDate}

# Processing Pipeline (Internal Logic)
1. 廣泛過濾：識別並鎖定發生在「扣除當天的未來一年」的所有事件。
2. 深度提取：從混亂文本中摳出 EPS、毛利率、營收成長率、大客戶訂單、技術突破、地緣政治風險。
3. 邏輯去重 (Critical)：若內容本質相同，僅保留最原始或資訊最齊全的一則，嚴禁重複。
4. 精煉總結：將去重後的乾貨轉化為 UI 需要的輸出格式。

# Constraints
- 嚴禁「幻覺」：若文中無具體數據，不採納
- 移除所有廣告、無關市場評論與情緒性廢話
- 每筆事件都要附來源網址（原始新聞/財報/公告）
- 不要包含今天或過去的事件

# Output Format
只輸出純 JSON 陣列，不輸出其他任何文字（不要 markdown code block）：
${outputFormat}`;

  const GEMINI_MODELS = [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "google/gemini-1.5-flash",
  ];

  const errors: string[] = [];

  for (const model of GEMINI_MODELS) {
    console.log(`Fallback (Gemini one-shot): ${model}`);
    const result = await callModel(apiKey, model, [
      { role: 'user', content: combinedPrompt }
    ], 0.3);

    if (result.ok) {
      return new Response(JSON.stringify({
        text: result.text,
        response: result.text,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    errors.push(`${model}(${result.status})`);
  }

  const hasCreditIssue = errors.some((e) => e.includes('(402)'));
  const hasModelIssue = errors.some((e) => e.includes('(400)') || e.includes('(404)'));

  const detail = hasCreditIssue
    ? `Gemini 額度不足或可用 token 不足：${errors.join(', ')}`
    : hasModelIssue
      ? `模型 ID 或端點不可用：${errors.join(', ')}`
      : `Gemini fallback 全部失敗：${errors.join(', ')}`;

  return new Response(JSON.stringify({
    error: '行事曆產生失敗，所有模型均無法使用',
    detail,
  }), {
    status: hasCreditIssue ? 402 : 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
