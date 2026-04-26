// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
// 把 Pro 放在第一順位，因 23+ 持倉時 Flash 8K context 不夠完成完整 markdown 報告
const GATEWAY_MODELS = ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash'];

async function callAI(messages: any[], temperature = 0.3, maxTokens = 8192): Promise<string> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');

  // Primary: Lovable AI Gateway
  if (lovableKey) {
    for (const model of GATEWAY_MODELS) {
      try {
        const response = await fetch(GATEWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        });
        if (response.status === 429) { console.log(`Gateway ${model} rate limited`); continue; }
        if (!response.ok) { console.error(`Gateway ${model} failed (${response.status})`); continue; }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) { console.error(`Gateway ${model} error:`, err); }
    }
  }

  // Fallback: Direct Gemini API
  if (geminiKey) {
    const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const nonSystem = messages.filter((m: any) => m.role !== 'system');
    const contents = nonSystem.map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    for (const model of GEMINI_MODELS) {
      try {
        const body: any = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
        if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        );
        if (response.status === 429) { continue; }
        if (!response.ok) { continue; }
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim();
        if (text) return text;
      } catch {}
    }
  }

  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!Deno.env.get('LOVABLE_API_KEY') && !Deno.env.get('GOOGLE_GEMINI_API_KEY')) {
    return new Response(JSON.stringify({ error: 'AI API key 未設定' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const systemPrompt = (body.systemPrompt || '').toString().trim();
    const userPrompt = (body.userPrompt || body.prompt || '').toString().trim();

    if (!userPrompt || userPrompt.length < 4) {
      return new Response(JSON.stringify({ error: 'userPrompt 為必填且不可過短' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    const text = await callAI(messages, 0.3);

    if (!text) {
      return new Response(JSON.stringify({ error: 'AI 分析失敗，所有模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      content: [{ text }], text, response: text,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('AI analysis error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'AI 分析失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
