// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GATEWAY_MODELS = ['google/gemini-2.5-flash', 'google/gemini-2.0-flash'];

async function callAI(messages: any[], temperature = 0.3, maxTokens = 4000): Promise<string> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');

  if (lovableKey) {
    for (const model of GATEWAY_MODELS) {
      try {
        const response = await fetch(GATEWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        });
        if (response.status === 429) { continue; }
        if (!response.ok) { console.error(`Gateway ${model} failed (${response.status})`); continue; }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) { console.error(`Gateway ${model} error:`, err); }
    }
  }

  if (geminiKey) {
    const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const contents = messages.filter((m: any) => m.role !== 'system').map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }],
    }));
    for (const model of GEMINI_MODELS) {
      try {
        const body: any = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
        if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        );
        if (response.status === 429) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim();
        if (text) return text;
      } catch {}
    }
  }

  throw new Error('所有 AI 模型均無法使用');
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    userId = user?.id || null;
  } catch {}
  if (!userId) {
    return new Response(JSON.stringify({ error: '未認證' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action, code, name, holdings, brain, dossier, researchHistory } = body;

    if (action === 'deep-research') {
      const dossierContext = dossier ? JSON.stringify(dossier, null, 2) : '無 dossier 資料';
      const brainContext = brain ? JSON.stringify(brain, null, 2) : '無策略大腦';
      
      const text = await callAI([
        { role: 'system', content: `你是一位資深台股研究分析師。你會根據持股 dossier、策略大腦規則、市場數據，對指定股票進行深度研究分析。
分析要全面且具實戰價值，包含：技術面、基本面、籌碼面、事件催化、風險因子。
格式要清楚，使用 markdown 標題分段。最後要給出明確的操作建議和目標價。` },
        { role: 'user', content: `請對 ${name}(${code}) 進行深度研究。\n\n持股 Dossier：\n${dossierContext}\n\n策略大腦：\n${brainContext}\n\n請提供完整的深度研究報告。` },
      ], 0.3, 4000);

      const report = {
        id: Date.now(), code, name,
        date: new Date().toLocaleDateString('zh-TW'),
        timestamp: Date.now(), text, type: 'deep-research',
      };

      const { data: existing } = await supabase.from('checkup_storage').select('data')
        .eq('user_id', userId).eq('key', 'research-history').maybeSingle();
      const history = Array.isArray(existing?.data) ? existing.data : [];
      const updated = [report, ...history].slice(0, 30);
      await supabase.from('checkup_storage').upsert(
        { user_id: userId, key: 'research-history', data: updated, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );

      return new Response(JSON.stringify({ text, report }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'system-review') {
      const holdingsContext = holdings ? JSON.stringify(holdings, null, 2) : '無持倉';
      const brainContext = brain ? JSON.stringify(brain, null, 2) : '無策略大腦';

      const text = await callAI([
        { role: 'system', content: `你是投資系統自我審視助手。你會審視整個投資系統（持倉、策略規則、歷史分析）並提出改善建議。
重點：找出系統性問題、規則矛盾、風險盲點、遺漏的研究方向。` },
        { role: 'user', content: `請審視我的投資系統並提出改善建議。\n\n持倉概要：\n${holdingsContext}\n\n策略大腦：\n${brainContext}\n\n研究歷史：\n${JSON.stringify(researchHistory?.slice(0, 5) || [], null, 2)}\n\n請提出具體的改善建議。` },
      ], 0.3, 3000);

      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get-history') {
      const { data } = await supabase.from('checkup_storage').select('data')
        .eq('user_id', userId).eq('key', 'research-history').maybeSingle();
      return new Response(JSON.stringify({ history: data?.data || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: '未知 action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Research error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '研究分析失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
