// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

async function callGemini(apiKey: string, model: string, messages: any[]): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const contents = messages.map((m: any) => {
      if (m.role === 'system') {
        return { role: 'user', parts: [{ text: m.content }] };
      }
      if (typeof m.content === 'string') {
        return { role: 'user', parts: [{ text: m.content }] };
      }
      const parts: any[] = [];
      for (const item of m.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url') {
          const url = item.image_url.url;
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
          }
        }
      }
      return { role: 'user', parts };
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini ${model} failed (${response.status}):`, errText.slice(0, 500));
      return { ok: false, text: errText, status: response.status };
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text ?? '').join('').trim();
    if (!text) {
      console.error(`Gemini ${model} returned empty content`);
      return { ok: false, text: '', status: 200 };
    }
    return { ok: true, text, status: 200 };
  } catch (err) {
    console.error(`Gemini ${model} exception:`, err);
    return { ok: false, text: String(err), status: 500 };
  }
}

async function callLovableAI(apiKey: string, systemPrompt: string, base64: string, mediaType: string): Promise<{ ok: boolean; text: string }> {
  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${base64}` },
          },
          { type: 'text', text: '解析這張成交截圖' },
        ],
      },
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Lovable AI failed (${response.status}):`, errText.slice(0, 500));
      return { ok: false, text: errText };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) {
      console.error('Lovable AI returned empty content');
      return { ok: false, text: '' };
    }
    return { ok: true, text };
  } catch (err) {
    console.error('Lovable AI exception:', err);
    return { ok: false, text: String(err) };
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

  const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');

  if (!geminiKey && !lovableKey) {
    return new Response(JSON.stringify({ error: 'No AI API key configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { systemPrompt, base64, mediaType } = await req.json();
    const mType = mediaType || 'image/jpeg';

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mType};base64,${base64}` } },
        { type: 'text', text: '解析這張成交截圖' },
      ],
    });

    // Strategy 1: Try direct Gemini API
    if (geminiKey) {
      for (let i = 0; i < GEMINI_MODELS.length; i++) {
        const model = GEMINI_MODELS[i];
        console.log(`Trying Gemini ${model} (${i + 1}/${GEMINI_MODELS.length})`);

        const result = await callGemini(geminiKey, model, messages);

        if (result.ok) {
          console.log(`Gemini ${model} succeeded`);
          return new Response(JSON.stringify({ content: [{ text: result.text }] }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (result.status === 429) {
          console.log(`Gemini ${model} rate limited, trying next`);
          continue;
        }
        // Non-429 error, still try next
      }
    }

    // Strategy 2: Fallback to Lovable AI Gateway
    if (lovableKey) {
      console.log('All Gemini models failed, falling back to Lovable AI Gateway');
      const result = await callLovableAI(lovableKey, systemPrompt || '解析成交截圖', base64, mType);

      if (result.ok) {
        console.log('Lovable AI Gateway succeeded');
        return new Response(JSON.stringify({ content: [{ text: result.text }] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
