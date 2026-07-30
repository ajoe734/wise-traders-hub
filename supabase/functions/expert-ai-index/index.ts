// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 建立／更新指定導師的知識庫向量索引。
// 輸入: { expert_id, trigger_source? } — 需 service role 或 company_admin 或該導師本人身份呼叫。
// 步驟: 1) 開一筆 run（status=running）
//       2) 拉 experts.bio/description/style/strategy/signals → chunk → embed
//       3) 先 DELETE 舊 chunks 再 INSERT 新的
//       4) 更新 run（status=success/failed + 統計）
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { embedText } from '../_shared/ai-gateway.ts';

const CHUNK_SIZE = 800;
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

  // AUTH: user — enforce BEFORE body parsing (M-3c contract)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('unauthorized', 401);
  const userClient = userClient(req);
  const { data: userData } = await userClient.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return errorResponse('unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const expertId = body.expert_id as string | undefined;
  const triggerSource = (body.trigger_source as string | undefined) || 'manual';
  if (!expertId) return errorResponse('expert_id required', 400);

  const admin = serviceClient();
  const { data: exp } = await admin.from('experts').select('user_id').eq('id', expertId).maybeSingle();
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', uid).in('role', ['company_admin']).maybeSingle();
  if (exp?.user_id !== uid && !role) return errorResponse('forbidden', 403);

  // 開一筆 run
  const startedAt = new Date();
  const { data: runRow } = await admin
    .from('expert_ai_index_runs')
    .insert({ expert_id: expertId, status: 'running', trigger_source: triggerSource, started_at: startedAt.toISOString() })
    .select('id')
    .maybeSingle();
  const runId = runRow?.id as string | undefined;

  const finish = async (patch: Record<string, any>) => {
    if (!runId) return;
    const finishedAt = new Date();
    await admin.from('expert_ai_index_runs').update({
      ...patch,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    }).eq('id', runId);
  };

  try {
    const { data: expert, error: expErr } = await admin
      .from('experts')
      .select('id, name, bio, description, strategy_summary, strategy_name, risk_preference, operation_cycle, style_tags')
      .eq('id', expertId)
      .maybeSingle();
    if (expErr || !expert) {
      await finish({ status: 'failed', error_message: 'expert not found' });
      return errorResponse('expert not found', 404);
    }

    const { data: signals } = await admin
      .from('expert_signals')
      .select('id, instrument, action, published_at, reason_summary, reason_detail, risk_notes, learning_points, overall_summary')
      .eq('expert_id', expertId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(500);

    type ChunkInput = { source_type: string; source_id: string | null; content: string; metadata: any };
    const chunks: ChunkInput[] = [];

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

    const totalChunks = chunks.length;
    log.info('chunks_built', { count: totalChunks });
    await admin.from('expert_ai_index_runs').update({ total_chunks: totalChunks }).eq('id', runId!);

    if (totalChunks === 0) {
      // 只清 auto-sync 條目，不動老師手動輸入的 (is_manual=true)
      await admin.from('expert_knowledge_chunks').delete().eq('expert_id', expertId).eq('is_manual', false);
      await finish({ status: 'success', indexed_chunks: 0, embed_failures: 0 });
      return jsonResponse({ ok: true, indexed: 0 });
    }

    const BATCH = 50;
    const rows: any[] = [];
    let embedFailures = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
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
          embedFailures += 1;
          log.error('embed_failed', { err: (e as Error).message });
        }
      }
      // 即時更新進度
      await admin.from('expert_ai_index_runs').update({
        indexed_chunks: rows.length,
        embed_failures: embedFailures,
      }).eq('id', runId!);
    }

    const { error: delErr } = await admin.from('expert_knowledge_chunks')
      .delete().eq('expert_id', expertId).eq('is_manual', false);
    if (delErr) {
      await finish({ status: 'failed', error_message: 'delete failed: ' + delErr.message, indexed_chunks: 0, embed_failures: embedFailures });
      return errorResponse('delete failed: ' + delErr.message, 500);
    }

    const INSERT_BATCH = 20;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const slice = rows.slice(i, i + INSERT_BATCH);
      const { error: insErr } = await admin.from('expert_knowledge_chunks').insert(slice);
      if (insErr) {
        log.error('insert_failed', { err: insErr.message });
        await finish({ status: 'failed', error_message: 'insert failed: ' + insErr.message, indexed_chunks: 0, embed_failures: embedFailures });
        return errorResponse('insert failed: ' + insErr.message, 500);
      }
    }

    await finish({ status: 'success', indexed_chunks: rows.length, embed_failures: embedFailures, error_message: null });
    return jsonResponse({ ok: true, indexed: rows.length, expert: expert.name });
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    log.error('run_failed', { err: msg });
    await finish({ status: 'failed', error_message: msg });
    return errorResponse(msg, 500);
  }
}));
