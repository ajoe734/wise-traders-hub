// 建立／更新指定導師的知識庫向量索引。
// 輸入: { expert_id } — 需 service role 或 company_admin 或該導師本人身份呼叫。
// 步驟: 1) 拉 experts.bio/description/style/strategy/signals → chunk → embed
//       2) 先 DELETE 舊 chunks 再 INSERT 新的
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { embedText } from '../_shared/ai-gateway.ts';

const CHUNK_SIZE = 800; // 中文約 800 字/chunk
const CHUNK_OVERLAP = 100;

function stripHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

Deno.serve(withLogging('expert-ai-index', async (req, log) => {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return errorResponse('missing env', 500);
  }

  const body = await req.json().catch(() => ({}));
  const expertId = body.expert_id as string | undefined;
  if (!expertId) return errorResponse('expert_id required', 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // 呼叫者身份檢查: 本人 or company_admin
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return errorResponse('unauthorized', 401);
    const { data: exp } = await admin.from('experts').select('user_id').eq('id', expertId).maybeSingle();
    const { data: role } = await admin.from('user_roles').select('role').eq('user_id', uid).in('role', ['company_admin']).maybeSingle();
    if (exp?.user_id !== uid && !role) return errorResponse('forbidden', 403);
  }

  // 1) 取資料
  const { data: expert, error: expErr } = await admin
    .from('experts')
    .select('id, name, bio, description, strategy_summary, strategy_name, risk_preference, operation_cycle, style_tags')
    .eq('id', expertId)
    .maybeSingle();
  if (expErr || !expert) return errorResponse('expert not found', 404);

  const { data: signals } = await admin
    .from('expert_signals')
    .select('id, instrument, action, published_at, reason_summary, reason_detail, risk_notes, learning_points, overall_summary')
    .eq('expert_id', expertId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(500);

  // 2) 組 chunks
  type ChunkInput = { source_type: string; source_id: string | null; content: string; metadata: any };
  const chunks: ChunkInput[] = [];

  // bio chunk
  const bioParts = [
    expert.name && `導師：${expert.name}`,
    expert.bio && `個人簡介：${stripHtml(expert.bio)}`,
    expert.description && `描述：${stripHtml(expert.description)}`,
    expert.strategy_name && `策略名稱：${expert.strategy_name}`,
    expert.strategy_summary && `策略摘要：${stripHtml(expert.strategy_summary)}`,
    expert.risk_preference && `風險偏好：${expert.risk_preference}`,
    expert.operation_cycle && `操作週期：${expert.operation_cycle}`,
    expert.style_tags?.length && `風格標籤：${expert.style_tags.join('、')}`,
  ].filter(Boolean).join('\n');
  if (bioParts) {
    for (const c of chunkText(bioParts)) {
      chunks.push({ source_type: 'bio', source_id: null, content: c, metadata: { name: expert.name } });
    }
  }

  // signals chunks
  for (const s of signals || []) {
    const parts = [
      `【${s.published_at?.slice(0, 10) || ''}】${s.instrument} ${s.action}`,
      s.reason_summary && `為什麼這樣操作：${stripHtml(s.reason_summary)}`,
      s.reason_detail && `部位控管想法：${stripHtml(s.reason_detail)}`,
      s.risk_notes && `風險提醒：${stripHtml(s.risk_notes)}`,
      s.learning_points && `教學重點：${stripHtml(s.learning_points)}`,
      s.overall_summary && `整體摘要：${stripHtml(s.overall_summary)}`,
    ].filter(Boolean).join('\n');
    if (!parts) continue;
    for (const c of chunkText(parts)) {
      chunks.push({
        source_type: 'signal',
        source_id: s.id,
        content: c,
        metadata: { instrument: s.instrument, action: s.action, published_at: s.published_at },
      });
    }
  }

  log.info('chunks_built', { count: chunks.length });

  if (chunks.length === 0) {
    // 清空舊資料
    await admin.from('expert_knowledge_chunks').delete().eq('expert_id', expertId);
    return jsonResponse({ ok: true, indexed: 0 });
  }

  // 3) 批次 embed（每次最多 100 個 input）
  const BATCH = 50;
  const rows: any[] = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    // 序列避免 rate limit
    for (const c of batch) {
      try {
        const vec = await embedText(LOVABLE_API_KEY, c.content);
        rows.push({
          expert_id: expertId,
          source_type: c.source_type,
          source_id: c.source_id,
          content: c.content,
          embedding: `[${vec.join(',')}]`,
          metadata: c.metadata,
        });
      } catch (e) {
        log.error('embed_failed', { err: (e as Error).message });
      }
    }
  }

  // 4) 覆寫
  const { error: delErr } = await admin.from('expert_knowledge_chunks').delete().eq('expert_id', expertId);
  if (delErr) return errorResponse('delete failed: ' + delErr.message, 500);

  // 分批 insert 避免 payload 過大
  const INSERT_BATCH = 20;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const slice = rows.slice(i, i + INSERT_BATCH);
    const { error: insErr } = await admin.from('expert_knowledge_chunks').insert(slice);
    if (insErr) {
      log.error('insert_failed', { err: insErr.message });
      return errorResponse('insert failed: ' + insErr.message, 500);
    }
  }

  return jsonResponse({ ok: true, indexed: rows.length, expert: expert.name });
}));
