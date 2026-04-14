// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CLAUDE_MODELS = ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'];

async function callClaudeVision(apiKey: string, model: string, systemPrompt: string, base64: string, mediaType: string): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        system: systemPrompt || '',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: '解析這張成交截圖',
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Claude ${model} failed (${response.status}):`, errText.slice(0, 500));
      return { ok: false, text: errText, status: response.status };
    }

    const data = await response.json();
    const text = data.content?.map((b: any) => b.text || '').join('').trim();
    if (!text) {
      console.error(`Claude ${model} returned empty content`);
      return { ok: false, text: '', status: 200 };
    }
    return { ok: true, text, status: 200 };
  } catch (err) {
    console.error(`Claude ${model} exception:`, err);
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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY 未設定' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { systemPrompt, base64, mediaType } = await req.json();
    const mType = mediaType || 'image/jpeg';

    for (let i = 0; i < CLAUDE_MODELS.length; i++) {
      const model = CLAUDE_MODELS[i];
      console.log(`Trying Claude ${model} (${i + 1}/${CLAUDE_MODELS.length})`);

      const result = await callClaudeVision(apiKey, model, systemPrompt || '', base64, mType);

      if (result.ok) {
        console.log(`Claude ${model} succeeded`);
        return new Response(JSON.stringify({ content: [{ text: result.text }] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (result.status === 429) {
        console.log(`Claude ${model} rate limited, trying next`);
        continue;
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
