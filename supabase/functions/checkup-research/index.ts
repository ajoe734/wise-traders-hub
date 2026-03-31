// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

async function callGemini(apiKey: string, model: string, system: string, user: string, maxTokens = 4000): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: system + '\n\n' + user }] },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
      }),
    }
  );
  if (!response.ok) throw new Error(`Gemini ${model} failed (${response.status})`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callAiText(apiKey: string, system: string, user: string, maxTokens = 4000): Promise<string> {
  for (const model of MODELS) {
    try {
      const text = await callGemini(apiKey, model, system, user, maxTokens);
      if (text) return text;
    } catch (e) {
      console.error(`Model ${model} failed:`, e);
      continue;
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

  const apiKey = Deno.env.get('GEMINI_ANALYSIS_API_KEY') || Deno.env.get('GOOGLE_GEMINI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI API KEY 未設定' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json();
    const { action, code, name, holdings, brain, dossier, researchHistory } = body;

    if (action === 'deep-research') {
      // Build research context from dossier
      const dossierContext = dossier ? JSON.stringify(dossier, null, 2) : '無 dossier 資料';
      const brainContext = brain ? JSON.stringify(brain, null, 2) : '無策略大腦';
      
      const system = `你是一位資深台股研究分析師。你會根據持股 dossier、策略大腦規則、市場數據，對指定股票進行深度研究分析。
分析要全面且具實戰價值，包含：技術面、基本面、籌碼面、事件催化、風險因子。
格式要清楚，使用 markdown 標題分段。最後要給出明確的操作建議和目標價。`;

      const user = `請對 ${name}(${code}) 進行深度研究。

持股 Dossier：
${dossierContext}

策略大腦：
${brainContext}

請提供完整的深度研究報告。`;

      const text = await callAiText(apiKey, system, user, 4000);

      // Save to research history in checkup_storage
      const report = {
        id: Date.now(),
        code,
        name,
        date: new Date().toLocaleDateString('zh-TW'),
        timestamp: Date.now(),
        text,
        type: 'deep-research',
      };

      // Append to research history
      const { data: existing } = await supabase
        .from('checkup_storage')
        .select('data')
        .eq('key', 'research-history')
        .maybeSingle();
      const history = Array.isArray(existing?.data) ? existing.data : [];
      const updated = [report, ...history].slice(0, 30);
      await supabase
        .from('checkup_storage')
        .upsert({ key: 'research-history', data: updated, updated_at: new Date().toISOString() }, { onConflict: 'key' });

      return new Response(JSON.stringify({ text, report }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'system-review') {
      const holdingsContext = holdings ? JSON.stringify(holdings, null, 2) : '無持倉';
      const brainContext = brain ? JSON.stringify(brain, null, 2) : '無策略大腦';

      const system = `你是投資系統自我審視助手。你會審視整個投資系統（持倉、策略規則、歷史分析）並提出改善建議。
重點：找出系統性問題、規則矛盾、風險盲點、遺漏的研究方向。`;

      const user = `請審視我的投資系統並提出改善建議。

持倉概要：
${holdingsContext}

策略大腦：
${brainContext}

研究歷史：
${JSON.stringify(researchHistory?.slice(0, 5) || [], null, 2)}

請提出具體的改善建議。`;

      const text = await callAiText(apiKey, system, user, 3000);

      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get-history') {
      const { data } = await supabase
        .from('checkup_storage')
        .select('data')
        .eq('key', 'research-history')
        .maybeSingle();
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
