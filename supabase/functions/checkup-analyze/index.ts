// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { consumeCheckupQuota, quotaErrorResponse } from "../_shared/checkupQuota.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// 用戶要求最高級：Opus 4 為主，Sonnet 4 為次選（皆為 Anthropic 目前最強模型）
const ANTHROPIC_MODELS = ['claude-opus-4-20250514', 'claude-sonnet-4-20250514'];
const GATEWAY_MODELS = ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash'];

async function callClaude(messages: any[], temperature: number, maxTokens: number, anthropicKey: string): Promise<string> {
  const systemMsg = messages.find((m: any) => m.role === 'system');
  const nonSystem = messages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  for (const model of ANTHROPIC_MODELS) {
    try {
      const body: any = { model, max_tokens: maxTokens, temperature, messages: nonSystem };
      if (systemMsg) body.system = systemMsg.content;
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (response.status === 429) { console.log(`Claude ${model} rate limited`); continue; }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`Claude ${model} failed (${response.status}): ${errText.slice(0, 300)}`);
        continue;
      }
      const data = await response.json();
      const text = (data.content || []).map((p: any) => p.text || '').join('').trim();
      if (text) return text;
    } catch (err) {
      console.error(`Claude ${model} error:`, err);
    }
  }
  return '';
}

async function callAI(messages: any[], temperature = 0.3, maxTokens = 8192): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');

  // Primary: Anthropic Claude (per user request — uses user's own Anthropic credits)
  if (anthropicKey) {
    const text = await callClaude(messages, temperature, maxTokens, anthropicKey);
    if (text) return text;
    console.warn('Claude failed across all models, falling back to Lovable Gateway / Gemini');
  }

  // Fallback 1: Lovable AI Gateway
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

  // Fallback 2: Direct Gemini API
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

  if (!Deno.env.get('ANTHROPIC_API_KEY') && !Deno.env.get('LOVABLE_API_KEY') && !Deno.env.get('GOOGLE_GEMINI_API_KEY')) {
    return new Response(JSON.stringify({ error: 'AI API key 未設定' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const issues = validateInput({
      fields: {
        userPrompt: { required: true, type: 'string', minLength: 4, label: 'userPrompt（或 prompt）', altKey: 'prompt' },
        systemPrompt: { required: false, type: 'string', label: 'systemPrompt' },
      },
      source: body,
    });
    if (issues.length) return validationResponse(issues, corsHeaders);

    // brain-update 是收盤分析的內部 follow-up（同一次健檢的延伸），仍要驗 JWT 但不扣配額
    const isBrainUpdate = body?.kind === 'brain-update';
    let quotaSnapshot: any = null;
    if (!isBrainUpdate) {
      const quota = await consumeCheckupQuota(req, 'analysis', corsHeaders);
      if (!quota.ok) return quotaErrorResponse(quota, corsHeaders);
      quotaSnapshot = quota.quota;
    } else {
      const auth = req.headers.get('Authorization') || '';
      if (!auth.replace(/^Bearer\s+/i, '').trim()) {
        return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const systemPrompt = (body.systemPrompt || '').toString().trim();
    const userPrompt = (body.userPrompt || body.prompt || '').toString().trim();


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
      quota: quotaSnapshot,
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
