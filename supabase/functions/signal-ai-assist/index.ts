// 訊號／週記富文字欄位的 AI 助寫
// 使用 Lovable AI Gateway，回傳一段 HTML 字串供 TipTap 直接 setContent。

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIELD_HINTS: Record<string, string> = {
  reason_summary: '欄位是「為什麼這樣操作？」，給訂閱者看的決策摘要，2~4 句、口語、避免空話。',
  reason_detail: '欄位是「部位控管想法」，可寫進場/出場/加碼條件、停損停利、心法。',
  risk_notes: '欄位是「風險提醒」，要明確點出可能的負面情境，避免絕對化保證收益的字眼。',
  learning_points: '欄位是「教學重點」，老師對學生的歸納，建議用清單呈現。',
  overall_summary: '欄位是「本週整體摘要」，2~3 句總結這一週的觀察，不寫每檔股票的細節。',
};

const MODE_HINTS: Record<string, string> = {
  rewrite: '請改寫得更口語、更好讀，篇幅與原本相近。',
  expand: '請補成更完整的段落，補充必要細節，但不要捏造未知資訊。',
  summarize: '請壓縮成 2~3 行的精簡摘要。',
  bulletize: '請整理成 3~6 點的條列清單（<ul><li>…</li></ul>）。',
  custom: '請依下方使用者指令處理。',
};

function htmlToText(html: string): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function plainToHtml(text: string): string {
  if (!text) return '';
  // 已經像 HTML：直接回（model 也常自帶 <ul>）
  if (/<\/?(p|ul|ol|li|h3|strong|em|blockquote|br)\b/i.test(text)) return text;
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // 看起來是清單
  if (lines.length > 1 && lines.every((l) => /^[-•・*\d.]/.test(l))) {
    const items = lines.map((l) => l.replace(/^[-•・*\d.\s]+/, '')).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY 未設定' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { mode, field, content, instruction, context } = await req.json();
    if (!mode || !content) {
      return new Response(JSON.stringify({ error: '缺少 mode 或 content' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fieldHint = FIELD_HINTS[field] || '欄位是投資週記/訊號的補充說明。';
    const modeHint = MODE_HINTS[mode] || '';
    const ctx = context
      ? `操作標的：${context.instrument || ''}，方向：${context.action || ''}，參考價：${context.price_hint || ''}。`
      : '';

    const systemPrompt = [
      '你是一位專業的台股投資週記編輯，協助分析師潤飾文字。',
      '輸出語言：繁體中文（台灣用語）。',
      fieldHint,
      modeHint,
      ctx,
      '嚴格規則：',
      '- 只回傳處理後的內容，不要加上任何「以下是修改後…」之類的前後綴。',
      '- 不要保證收益、不要使用「必漲」「穩賺」「保證」等字眼。',
      '- 如果原文資訊不足以完成擴寫，可以維持原意，不要捏造數據。',
      '- 可以用簡單的 HTML：<p> <strong> <em> <ul> <ol> <li> <h3> <blockquote>。不要 inline style、不要 class、不要 script。',
    ].filter(Boolean).join('\n');

    const userPrompt = [
      mode === 'custom' && instruction ? `使用者指令：${instruction}\n` : '',
      '原始內容（可能含 HTML 或純文字）：',
      content,
    ].join('\n');

    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: 'AI 助寫太頻繁，請稍候再試' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: 'AI 額度已用完，請聯繫管理員加值' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error('AI gateway error:', aiResp.status, t);
      return new Response(JSON.stringify({ error: 'AI 服務暫時無法使用' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiResp.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    const html = plainToHtml(text.trim());

    return new Response(JSON.stringify({ html }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('signal-ai-assist error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
