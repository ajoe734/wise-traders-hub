// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Stage 1: DeepSeek R1 for deep reasoning
const STAGE1_MODEL = "deepseek/deepseek-r1:free";
// Stage 2: Qwen for final structured output
const STAGE2_MODEL = "qwen/qwen-2.5-72b-instruct:free";
// Fallback models if the pipeline fails
const FALLBACK_MODELS = [
  "google/gemini-2.5-flash-preview:free",
  "google/gemini-2.5-flash",
  "qwen/qwen2.5-vl-72b-instruct",
];

async function callModel(apiKey: string, model: string, messages: any[], temperature: number): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wise-traders-hub.lovable.app',
        'X-Title': 'WiseTraders Checkup',
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
    const systemPrompt = body.systemPrompt || '';
    const userPrompt = body.userPrompt || body.prompt || '';

    // ===== Two-stage pipeline =====
    // Stage 1: DeepSeek R1 for reasoning/analysis
    console.log(`Stage 1: Calling ${STAGE1_MODEL} for deep reasoning...`);
    const stage1Messages: any[] = [];
    if (systemPrompt) {
      stage1Messages.push({
        role: 'system',
        content: `你是一位深度分析助手。請仔細思考並分析以下請求，提供你的完整推理過程和分析結論。你的輸出將被交給另一個模型來產生最終格式化結果。\n\n原始系統指令供參考：${systemPrompt}`,
      });
    }
    stage1Messages.push({ role: 'user', content: userPrompt });

    const stage1Result = await callModel(apiKey, STAGE1_MODEL, stage1Messages, 0.3);

    if (stage1Result.ok && stage1Result.text) {
      // Stage 2: Qwen for final structured output
      console.log(`Stage 1 succeeded. Stage 2: Calling ${STAGE2_MODEL} for final output...`);
      const stage2Messages: any[] = [];
      if (systemPrompt) {
        stage2Messages.push({ role: 'system', content: systemPrompt });
      }
      stage2Messages.push({
        role: 'user',
        content: `以下是一位深度分析助手對問題的分析結果，請根據此分析，嚴格按照系統指令要求的格式輸出最終結果。\n\n【分析助手的推理】\n${stage1Result.text}\n\n【原始問題】\n${userPrompt}`,
      });

      const stage2Result = await callModel(apiKey, STAGE2_MODEL, stage2Messages, 0.3);

      if (stage2Result.ok && stage2Result.text) {
        console.log(`Stage 2 succeeded. Two-stage pipeline complete.`);
        return new Response(JSON.stringify({
          content: [{ text: stage2Result.text }],
          text: stage2Result.text,
          response: stage2Result.text,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.warn(`Stage 2 (${STAGE2_MODEL}) failed, falling back to single-model...`);
    } else {
      console.warn(`Stage 1 (${STAGE1_MODEL}) failed, falling back to single-model...`);
    }

    // ===== Fallback: single-model approach =====
    const fallbackMessages: any[] = [];
    if (systemPrompt) {
      fallbackMessages.push({ role: 'system', content: systemPrompt });
    }
    fallbackMessages.push({ role: 'user', content: userPrompt });

    for (let i = 0; i < FALLBACK_MODELS.length; i++) {
      const model = FALLBACK_MODELS[i];
      console.log(`Fallback ${i + 1}/${FALLBACK_MODELS.length}: ${model}`);
      const result = await callModel(apiKey, model, fallbackMessages, 0.3);

      if (result.ok) {
        console.log(`Fallback model ${model} succeeded`);
        return new Response(JSON.stringify({
          content: [{ text: result.text }],
          text: result.text,
          response: result.text,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`Fallback model ${model} failed (status ${result.status}), trying next...`);
    }

    // All models failed
    return new Response(JSON.stringify({ error: 'AI 分析失敗，所有模型均無法使用' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('AI analysis error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'AI 分析失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
