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

async function callLovableAI(apiKey: string, model: string, messages: any[]): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 4096 }),
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

    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i];
      console.log(`Trying Lovable AI ${model} (${i + 1}/${MODELS.length})`);

      const result = await callLovableAI(apiKey, model, messages);

      if (result.ok) {
        console.log(`Lovable AI ${model} succeeded`);
        return new Response(JSON.stringify({ content: [{ text: result.text }] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Don't retry if rate limited (402/429)
      if (result.status === 402 || result.status === 429) {
        console.log(`Lovable AI rate limited (${result.status}), stopping`);
        return new Response(JSON.stringify({ error: 'AI 額度已用完，請稍後再試' }), {
          status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

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
