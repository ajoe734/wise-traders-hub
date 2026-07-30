// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// AI 訓練台後端：Persona / Few-shot / 手動知識條目 CRUD
// 所有動作要求：呼叫者是該 expert 的 user 或 company_admin
// POST body: { action, expert_id, ... }
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { embedText } from '../_shared/ai-gateway.ts';

Deno.serve(withLogging('expert-ai-studio', async (req, log) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return errorResponse('missing env', 500);
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('unauthorized', 401);

  const userClient = userClient(req);
  const { data: userData } = await userClient.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return errorResponse('unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;
  const expertId = body.expert_id as string | undefined;
  if (!action || !expertId) return errorResponse('action and expert_id required', 400);

  const admin = serviceClient();

  // 授權檢查
  const { data: expert } = await admin.from('experts').select('id, user_id, name').eq('id', expertId).maybeSingle();
  if (!expert) return errorResponse('expert not found', 404);
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', uid).eq('role', 'company_admin').maybeSingle();
  const isOwner = expert.user_id === uid;
  const isAdmin = !!role;
  if (!isOwner && !isAdmin) return errorResponse('forbidden', 403);

  try {
    switch (action) {
      // -------- Persona --------
      case 'get_persona': {
        const { data } = await admin.from('expert_ai_personas').select('*').eq('expert_id', expertId).maybeSingle();
        return jsonResponse({ ok: true, persona: data });
      }
      case 'save_persona': {
        const patch = {
          expert_id: expertId,
          system_prompt: body.system_prompt ?? null,
          tone: body.tone ?? [],
          forbidden_topics: body.forbidden_topics ?? [],
          disclaimer: body.disclaimer ?? null,
          model: body.model || 'openai/gpt-5',
          updated_by: uid,
        };
        const { data, error } = await admin
          .from('expert_ai_personas')
          .upsert(patch, { onConflict: 'expert_id' })
          .select()
          .maybeSingle();
        if (error) throw error;
        return jsonResponse({ ok: true, persona: data });
      }

      // -------- Few-shots --------
      case 'list_fewshots': {
        const { data } = await admin
          .from('expert_ai_fewshots')
          .select('*')
          .eq('expert_id', expertId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });
        return jsonResponse({ ok: true, items: data || [] });
      }
      case 'upsert_fewshot': {
        const id = body.id as string | undefined;
        const patch = {
          expert_id: expertId,
          question: String(body.question || '').trim(),
          answer: String(body.answer || '').trim(),
          sort_order: Number(body.sort_order ?? 0),
          status: isAdmin && body.status ? body.status : (isOwner ? 'approved' : 'pending'),
          created_by: uid,
          reviewed_by: isAdmin ? uid : null,
          reviewed_at: isAdmin ? new Date().toISOString() : null,
        };
        if (!patch.question || !patch.answer) return errorResponse('question and answer required', 400);
        if (id) {
          const { data, error } = await admin.from('expert_ai_fewshots').update(patch).eq('id', id).select().maybeSingle();
          if (error) throw error;
          return jsonResponse({ ok: true, item: data });
        } else {
          const { data, error } = await admin.from('expert_ai_fewshots').insert(patch).select().maybeSingle();
          if (error) throw error;
          return jsonResponse({ ok: true, item: data });
        }
      }
      case 'delete_fewshot': {
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        await admin.from('expert_ai_fewshots').delete().eq('id', id).eq('expert_id', expertId);
        return jsonResponse({ ok: true });
      }
      case 'review_fewshot': {
        const id = body.id as string;
        const status = body.status as 'approved' | 'rejected';
        if (!id || !['approved', 'rejected'].includes(status)) return errorResponse('bad params', 400);
        const { data, error } = await admin.from('expert_ai_fewshots').update({
          status, reviewed_by: uid, reviewed_at: new Date().toISOString(),
        }).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (error) throw error;
        return jsonResponse({ ok: true, item: data });
      }

      // -------- Manual knowledge chunks --------
      case 'list_chunks': {
        const scope = (body.scope as string) || 'manual'; // manual | all
        const status = body.status as string | undefined; // pending | approved | rejected | undefined(all)
        let q = admin.from('expert_knowledge_chunks')
          .select('id, source_type, title, content, is_manual, status, metadata, created_at, updated_at, training_session_id')
          .eq('expert_id', expertId)
          .order('updated_at', { ascending: false })
          .limit(500);
        if (scope === 'manual') q = q.eq('is_manual', true);
        if (status && ['pending', 'approved', 'rejected'].includes(status)) q = q.eq('status', status);
        const { data, error } = await q;
        if (error) throw error;
        return jsonResponse({ ok: true, items: data || [] });
      }
      case 'add_chunk': {
        const title = String(body.title || '').trim() || null;
        const content = String(body.content || '').trim();
        if (!content) return errorResponse('content required', 400);
        if (content.length > 6000) return errorResponse('content too long (max 6000)', 400);
        const status = isAdmin ? (body.status || 'approved') : (isOwner ? 'approved' : 'pending');
        try {
          const vec = await embedText(LOVABLE_API_KEY, content);
          const { data, error } = await admin.from('expert_knowledge_chunks').insert({
            expert_id: expertId,
            source_type: body.source_type || 'manual',
            source_id: null,
            content,
            title,
            embedding: `[${vec.join(',')}]`,
            metadata: body.metadata || {},
            is_manual: true,
            status,
            created_by: uid,
            reviewed_by: isAdmin ? uid : null,
            reviewed_at: isAdmin ? new Date().toISOString() : null,
          }).select().maybeSingle();
          if (error) throw error;
          return jsonResponse({ ok: true, item: data });
        } catch (e) {
          const msg = (e as Error).message;
          log.error('embed_add_failed', { err: msg });
          return errorResponse('embed failed: ' + msg, 500, { requestId: log.requestId, stage: 'embed', action: 'add_chunk' });
        }
      }
      case 'update_chunk': {
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        const { data: existing } = await admin.from('expert_knowledge_chunks')
          .select('status, content').eq('id', id).eq('expert_id', expertId).maybeSingle();
        if (!existing) return errorResponse('chunk not found', 404);
        const patch: Record<string, unknown> = {};
        if (typeof body.title === 'string') patch.title = body.title.trim() || null;
        let contentChanged = false;
        if (typeof body.content === 'string') {
          const c = body.content.trim();
          if (!c) return errorResponse('content required', 400);
          if (c.length > 6000) return errorResponse('content too long', 400);
          if (c !== existing.content) {
            contentChanged = true;
            patch.content = c;
            try {
              const vec = await embedText(LOVABLE_API_KEY, c);
              patch.embedding = `[${vec.join(',')}]`;
            } catch (e) {
              return errorResponse('re-embed failed: ' + (e as Error).message, 500, { requestId: log.requestId, stage: 're_embed', action: 'update_chunk', candidateId: id });
            }
          }
        }
        if (body.status && (isAdmin || isOwner)) {
          if (!['pending', 'approved', 'rejected'].includes(body.status)) {
            return errorResponse('bad status', 400);
          }
          patch.status = body.status;
          patch.reviewed_by = uid;
          patch.reviewed_at = new Date().toISOString();
        } else if (contentChanged && existing.status === 'approved') {
          // 內容變了卻沒帶新狀態 → 強制降回 pending，避免未經審核的新內容直接進 RAG
          patch.status = 'pending';
          patch.reviewed_by = null;
          patch.reviewed_at = null;
        }
        const { data, error } = await admin.from('expert_knowledge_chunks')
          .update(patch).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (error) throw error;
        return jsonResponse({ ok: true, item: data, downgraded_to_pending: contentChanged && existing.status === 'approved' && !body.status });
      }

      // -------- Pending review queue --------
      case 'list_pending_chunks': {
        const { data, error } = await admin
          .from('expert_knowledge_chunks')
          .select('id, source_type, title, content, is_manual, status, metadata, created_by, created_at, embedding, training_session_id')
          .eq('expert_id', expertId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        // 只回傳「有沒有 embedding」的旗標，不要把 3072 維向量丟給前端
        const items = (data || []).map((r: any) => ({
          id: r.id,
          source_type: r.source_type,
          title: r.title,
          content: r.content,
          is_manual: r.is_manual,
          status: r.status,
          metadata: r.metadata,
          created_by: r.created_by,
          created_at: r.created_at,
          training_session_id: r.training_session_id,
          has_embedding: !!r.embedding,
        }));
        return jsonResponse({ ok: true, items });
      }

      case 'bulk_review_chunks': {
        const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter(Boolean) : [];
        const decision = body.decision as 'approve' | 'reject';
        if (ids.length === 0 || !['approve', 'reject'].includes(decision)) {
          return errorResponse('ids and decision required', 400);
        }
        if (!isAdmin && !isOwner) return errorResponse('forbidden', 403);

        if (decision === 'reject') {
          const { error } = await admin.from('expert_knowledge_chunks')
            .update({ status: 'rejected', reviewed_by: uid, reviewed_at: new Date().toISOString() })
            .in('id', ids).eq('expert_id', expertId).eq('status', 'pending');
          if (error) throw error;
          return jsonResponse({ ok: true, approved: 0, rejected: ids.length, embedded: 0, failed: [] });
        }

        // approve：若沒 embedding 就補跑，否則只改狀態
        const { data: rows, error: fetchErr } = await admin.from('expert_knowledge_chunks')
          .select('id, content, embedding').in('id', ids).eq('expert_id', expertId).eq('status', 'pending');
        if (fetchErr) throw fetchErr;

        let approved = 0, embedded = 0;
        const failed: Array<{ id: string; stage: 'embed' | 'update'; error: string }> = [];
        const nowIso = new Date().toISOString();

        for (const r of rows || []) {
          let stage: 'embed' | 'update' = 'embed';
          try {
            const patch: Record<string, unknown> = {
              status: 'approved', reviewed_by: uid, reviewed_at: nowIso,
            };
            if (!r.embedding) {
              const vec = await embedText(LOVABLE_API_KEY, r.content || '');
              patch.embedding = `[${vec.join(',')}]`;
              embedded += 1;
            }
            stage = 'update';
            const { error: updErr } = await admin.from('expert_knowledge_chunks')
              .update(patch).eq('id', r.id).eq('expert_id', expertId);
            if (updErr) throw updErr;
            approved += 1;
          } catch (e) {
            const msg = (e as Error).message;
            failed.push({ id: r.id, stage, error: msg });
            log.error('review_approve_failed', { candidateId: r.id, stage, err: msg });
          }
        }
        return jsonResponse({ ok: true, approved, rejected: 0, embedded, failed, requestId: log.requestId });
      }

      case 'delete_chunk': {
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        await admin.from('expert_knowledge_chunks').delete().eq('id', id).eq('expert_id', expertId);
        return jsonResponse({ ok: true });
      }

      // -------- Stats --------
      case 'stats': {
        const [{ count: manualCount }, { count: autoCount }, { count: pendingCount }, { data: lastRun }] = await Promise.all([
          admin.from('expert_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('expert_id', expertId).eq('is_manual', true),
          admin.from('expert_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('expert_id', expertId).eq('is_manual', false),
          admin.from('expert_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('expert_id', expertId).eq('status', 'pending'),
          admin.from('expert_ai_index_runs').select('*').eq('expert_id', expertId).order('started_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        return jsonResponse({
          ok: true,
          stats: {
            manual: manualCount ?? 0,
            auto: autoCount ?? 0,
            pending: pendingCount ?? 0,
            last_index_run: lastRun,
          },
        });
      }

      default:
        return errorResponse('unknown action: ' + action, 400);
    }
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    log.error('studio_failed', { action, err: msg });
    return errorResponse(msg, 500, { requestId: log.requestId, action });
  }
}));
