// AUTH: user  老師（作者）或管理員：判斷文章圖片類型；一般插圖才 AI 重繪，數據截圖回傳 frame 交前台確定性處理
import { z } from 'npm:zod@3.23.8';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireExpertOwnerOrAdmin } from '../_shared/adminGuard.ts';
import { AuthError } from '../_shared/authGuard.ts';
import { responsesJson, editImagePng, GatewayError } from '../_shared/articleAiGateway.ts';
import {
  ARTICLE_AI_LIMITS, quotaExceeded, routeImage, isOwnArticleUpload, LIEFLAT_RESTYLE_PROMPT, type ImageClassification,
} from '../_shared/articleAiCore.ts';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  expert_id: z.string().uuid(),
  image_url: z.string().url().max(1000),
  force_frame: z.boolean().optional(),
});

const CLASSIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'has_text_or_numbers', 'confidence'],
  properties: {
    kind: { type: 'string', enum: ['data', 'illustration'] },
    has_text_or_numbers: { type: 'boolean' },
    confidence: { type: 'number' },
  },
};

function b64ToBytes(b64: string) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(u: Uint8Array) {
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'invalid_input', details: parsed.error.flatten().fieldErrors }, 400);
    const { expert_id, image_url, force_frame } = parsed.data;
    await requireExpertOwnerOrAdmin(req, expert_id);
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    if (!isOwnArticleUpload(image_url, supaUrl, expert_id)) return json({ error: 'not_own_image' }, 403);
    if (force_frame) return json({ route: 'frame', reason: 'teacher_marked_data' });

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) return json({ error: 'ai_not_configured' }, 500);
    const admin = serviceClient();
    const { data: n, error: qErr } = await admin.rpc('consume_article_ai_quota', { _expert_id: expert_id, _kind: 'image', _limit: ARTICLE_AI_LIMITS.image });
    if (qErr) throw qErr;
    if (quotaExceeded(n as number)) return json({ error: 'quota_exceeded', limit: ARTICLE_AI_LIMITS.image }, 429);

    const imgRes = await fetch(image_url);
    if (!imgRes.ok) { await admin.rpc('refund_article_ai_quota', { _expert_id: expert_id, _kind: 'image' }); return json({ error: 'image_fetch_failed' }, 400); }
    const blob = await imgRes.blob();
    if (blob.size > 5 * 1024 * 1024 || !blob.type.startsWith('image/')) { await admin.rpc('refund_article_ai_quota', { _expert_id: expert_id, _kind: 'image' }); return json({ error: 'bad_image' }, 400); }
    const dataUrl = `data:${blob.type};base64,${bytesToB64(new Uint8Array(await blob.arrayBuffer()))}`;

    let cls: ImageClassification | null = null;
    try {
      cls = await responsesJson<ImageClassification>(apiKey, {
        instructions: '判斷這張圖片：若是 K 線、走勢圖、成交量、對帳單、表格、報價畫面，或圖中出現任何文字或數字，kind=data。只有不含文字數字的照片或插畫才是 illustration。confidence 為 0~1。',
        content: [{ type: 'input_text', text: '請分類這張圖片。' }, { type: 'input_image', image_url: dataUrl }],
        schemaName: 'image_classification', schema: CLASSIFY_SCHEMA,
      });
    } catch (e) {
      if (e instanceof GatewayError && (e.status === 402 || e.status === 403 || e.status === 429)) {
        await admin.rpc('refund_article_ai_quota', { _expert_id: expert_id, _kind: 'image' });
        return json({ error: e.status === 402 ? 'ai_credits' : 'ai_unavailable', message: e.message }, e.status);
      }
      cls = null; // 分類失敗 → 一律走確定性相框
    }
    if (routeImage(cls) === 'frame') return json({ route: 'frame', classification: cls });

    const b64 = await editImagePng(apiKey, blob, LIEFLAT_RESTYLE_PROMPT);
    const path = `${expert_id}/ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const up = await admin.storage.from('signal-media').upload(path, b64ToBytes(b64), { contentType: 'image/png', upsert: false });
    if (up.error) throw up.error;
    const { data: pub } = admin.storage.from('signal-media').getPublicUrl(path);
    return json({ route: 'restyle', classification: cls, url: pub.publicUrl });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code }, e.status);
    if (e instanceof GatewayError) return json({ error: e.status === 402 ? 'ai_credits' : 'ai_failed', message: e.message }, e.status >= 400 && e.status < 600 ? e.status : 502);
    console.error('article-ai-image error', e);
    return json({ error: 'internal' }, 500);
  }
});
