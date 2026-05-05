// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { consumeCheckupQuota, quotaErrorResponse } from "../_shared/checkupQuota.ts";

import { corsHeaders } from '../_shared/checkupCors.ts';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GATEWAY_MODELS = ['google/gemini-3-flash-preview', 'google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'];

async function callAI(messages: any[], temperature = 0.1, maxTokens = 900): Promise<string> {
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
        if (response.status === 429) continue;
        if (!response.ok) { console.error(`Gateway ${model} failed (${response.status})`); continue; }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) { console.error(`Gateway ${model} error:`, err); }
    }
  }

  if (geminiKey) {
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      try {
        const systemMsg = messages.find((m: any) => m.role === 'system');
        const body: any = {
          contents: [{ role: 'user', parts: [{ text: messages.find((m: any) => m.role === 'user')?.content || '' }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        };
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
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const issues = validateInput({
      fields: {
        report: {
          required: true,
          type: 'object',
          label: 'report',
          nested: {
            code: { required: true, type: 'string', pattern: /^\d{4,6}[A-Z]?$/i, label: 'report.code' },
            text: { required: true, type: 'string', minLength: 10, label: 'report.text' },
          },
        },
        stock: { required: false, type: 'object', label: 'stock' },
        dossier: { required: false, type: 'object', label: 'dossier' },
      },
      source: body,
    });
    if (issues.length) return validationResponse(issues, corsHeaders);

    const quotaResult = await consumeCheckupQuota(req, 'research-extract', corsHeaders);
    if (!quotaResult.ok) return quotaErrorResponse(quotaResult, corsHeaders);

    const { report, stock, dossier } = body;


    const systemPrompt = `你是台股研究資料抽取器。你的任務是從研究報告文字中抽出可回寫到持股 dossier 的結構化資料。
只能抽出文字裡有明確提到的數字或來源，不可猜測。
0 不是缺值佔位符。除非原文真的明確寫出 0，否則缺資料一律填 null，不可用 0 代替。
回傳純 JSON，不要 markdown。

格式：
{
  "fundamentals": {
    "revenueMonth": "YYYY/MM" 或 null,
    "revenueYoY": 數字或 null,
    "revenueMoM": 數字或 null,
    "quarter": "YYYYQn" 或 null,
    "eps": 數字或 null,
    "grossMargin": 數字或 null,
    "roe": 數字或 null,
    "updatedAt": "YYYY/MM/DD" 或 null,
    "source": "資料來源簡述",
    "note": "一句話摘要"
  },
  "targets": {
    "reports": [
      { "firm": "券商/來源", "target": 數字, "date": "YYYY/MM/DD 或 YYYY/MM" }
    ]
  },
  "meta": {
    "industry": "產業/次產業" 或 null,
    "strategy": "投資策略一句話" 或 null,
    "leader": "族群龍頭股名" 或 null,
    "position": "波段/長線/短線/觀望" 或 null
  }
}`;

    const userPrompt = `股票：${stock?.name || report.name || ""}(${report.code})
研究日期：${report.date || ""}

現有 dossier 摘要：
${JSON.stringify(dossier || {}, null, 2)}

研究全文：
${report.text}

請抽出可回寫的財報/營收/目標價/產業策略資料。`;

    const text = await callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 0.1, 1200);

    if (!text) {
      return new Response(JSON.stringify({ error: '所有 AI 模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanText = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    // Persist meta override + target history (best-effort, service role)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      const userId = user?.id || null;

      if (userId) {
        const code = String(report.code || '').trim();
        const meta = parsed?.meta || null;
        if (meta && (meta.industry || meta.strategy || meta.leader || meta.position)) {
          await supabase.from('holding_meta_overrides').upsert({
            user_id: userId, code,
            industry: meta.industry || null,
            strategy: meta.strategy || null,
            leader: meta.leader || null,
            position: meta.position || null,
            source: 'ai_enrich',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,code' });

          // 依使用者偏好寫站內通知
          const { data: prefs } = await supabase
            .from('notification_preferences')
            .select('meta_override_changed')
            .eq('user_id', userId)
            .maybeSingle();
          if (prefs?.meta_override_changed !== false) {
            await supabase.from('notifications').insert({
              user_id: userId,
              title: `${code} 研究覆蓋已更新`,
              body: `AI 已更新產業/策略/領頭欄位（${[meta.industry, meta.strategy, meta.leader, meta.position].filter(Boolean).join(' · ')}）`,
              type: 'info',
              link: '/account/notifications',
            });
          }
        }

        const reports = Array.isArray(parsed?.targets?.reports) ? parsed.targets.reports : [];
        const batchId = crypto.randomUUID();
        for (const r of reports) {
          const target = Number(r?.target);
          if (!Number.isFinite(target) || target <= 0) continue;
          await supabase.from('target_price_history').insert({
            user_id: userId, code,
            firm: String(r.firm || '').trim(),
            target,
            report_date: String(r.date || '').trim() || null,
            change_type: 'new',
            source: 'enrich-dossier',
            batch_id: batchId,
            detail: { stockName: stock?.name || report.name || null },
          });
        }
      }
    } catch (persistErr) {
      console.error('research-extract persist error:', persistErr);
    }

    return new Response(JSON.stringify({
      fundamentals: parsed?.fundamentals || null,
      targets: parsed?.targets || { reports: [] },
      meta: parsed?.meta || null,
      quota: quotaResult.quota,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Research extract error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: '研究資料抽取失敗', detail: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
