// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CLAUDE_MODELS = ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'];

async function callClaude(apiKey: string, model: string, messages: any[], temperature: number, maxTokens = 4096): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m: any) => m.role !== 'system');

    const body: any = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: nonSystemMsgs.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Claude ${model} failed (${response.status}):`, errText);
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
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const systemPrompt = body.systemPrompt || '';
    const userPrompt = body.userPrompt || body.prompt || '';

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    for (let i = 0; i < CLAUDE_MODELS.length; i++) {
      const model = CLAUDE_MODELS[i];
      console.log(`Analyze: trying Claude ${model} (${i + 1}/${CLAUDE_MODELS.length})`);

      const result = await callClaude(apiKey, model, messages, 0.3);

      if (result.ok) {
        console.log(`Claude ${model} succeeded`);
        return new Response(JSON.stringify({
          content: [{ text: result.text }],
          text: result.text,
          response: result.text,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (result.status === 429) {
        console.log(`Claude rate limited, trying next model`);
        continue;
      }
    }

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
