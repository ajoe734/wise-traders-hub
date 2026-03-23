// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-2.5-flash",
  "qwen/qwen2.5-vl-72b-instruct",
];

async function tryModel(apiKey: string, model: string, messages: any[], temperature: number): Promise<{ ok: boolean; text: string; status: number }> {
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
    const { systemPrompt, base64, mediaType } = await req.json();

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mediaType || 'image/jpeg'};base64,${base64}`,
          },
        },
        { type: 'text', text: '解析這張成交截圖' },
      ],
    });

    // Try each model sequentially until one succeeds
    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i];
      console.log(`Trying model ${i + 1}/${MODELS.length}: ${model}`);
      const result = await tryModel(apiKey, model, messages, 0.1);

      if (result.ok) {
        console.log(`Model ${model} succeeded`);
        return new Response(JSON.stringify({ content: [{ text: result.text }] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Model ${model} failed (status ${result.status}), trying next...`);
    }

    // All models failed
    return new Response(JSON.stringify({ error: 'AI 解析失敗，所有模型均無法使用' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Parse error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '解析失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
