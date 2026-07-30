// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 週五訓練對話台：讀該週已發佈週記→AI 提補完題→老師回覆→AI 產出候選知識條目與週記建議
// Actions: list_weeks | get_session | start_session | save_answers | generate_suggestions | accept_knowledge | discard_session | complete_session
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { embedText, createLovableAiGatewayProvider } from '../_shared/ai-gateway.ts';
import { taipeiMondayOf, taipeiWeekRangeUtc } from '../_shared/weekBoundary.ts';
import { generateText, Output } from 'npm:ai';
import { z } from 'npm:zod';

const DEFAULT_MODEL = 'openai/gpt-5';

function fmtSignalBlock(s: any): string {
  const parts = [
    `【${s.published_at?.slice(0, 10) || ''}】${s.instrument || ''} ${s.action || ''}`,
    s.reason_summary && `摘要：${s.reason_summary}`,
    s.reason_detail && `細節：${s.reason_detail}`,
    s.risk_notes && `風險：${s.risk_notes}`,
    s.learning_points && `教學：${s.learning_points}`,
    s.overall_summary && `整體：${s.overall_summary}`,
  ].filter(Boolean);
  return parts.join('\n');
}

Deno.serve(withLogging('expert-ai-training', async (req, log) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return errorResponse('missing env', 500);

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
  const { data: expert } = await admin.from('experts').select('id, user_id, name').eq('id', expertId).maybeSingle();
  if (!expert) return errorResponse('expert not found', 404);
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', uid).eq('role', 'company_admin').maybeSingle();
  const isOwner = expert.user_id === uid;
  const isAdmin = !!role;
  if (!isOwner && !isAdmin) return errorResponse('forbidden', 403);

  const getModel = async () => {
    const { data: persona } = await admin.from('expert_ai_personas').select('model, system_prompt, tone, forbidden_topics, disclaimer').eq('expert_id', expertId).maybeSingle();
    return { model: persona?.model || DEFAULT_MODEL, persona };
  };

  try {
    switch (action) {
      case 'list_weeks': {
        // 抓最近 12 週有發佈週記的 week_start
        const since = new Date(Date.now() - 12 * 7 * 86400000).toISOString();
        const { data: signals, error: sigErr } = await admin
          .from('expert_signals')
          .select('id, published_at')
          .eq('expert_id', expertId)
          .eq('status', 'published')
          .gte('published_at', since)
          .order('published_at', { ascending: false })
          .limit(500);
        if (sigErr) throw sigErr;

        const bucket = new Map<string, { week_start: string; signal_count: number; latest_published_at: string }>();
        for (const s of signals || []) {
          if (!s.published_at) continue;
          const wk = taipeiMondayOf(new Date(s.published_at));
          const cur = bucket.get(wk);
          if (!cur) bucket.set(wk, { week_start: wk, signal_count: 1, latest_published_at: s.published_at });
          else { cur.signal_count += 1; if (s.published_at > cur.latest_published_at) cur.latest_published_at = s.published_at; }
        }
        const weeks = Array.from(bucket.values()).sort((a, b) => b.week_start.localeCompare(a.week_start));

        const { data: sessions, error: seErr } = await admin
          .from('expert_ai_training_sessions')
          .select('id, week_start, status, updated_at')
          .eq('expert_id', expertId)
          .in('week_start', weeks.map((w) => w.week_start));
        if (seErr) throw seErr;

        const byWeek = new Map<string, any>();
        for (const s of sessions || []) byWeek.set(s.week_start, s);

        return jsonResponse({
          ok: true,
          weeks: weeks.map((w) => ({ ...w, session: byWeek.get(w.week_start) || null })),
        });
      }

      case 'list_sessions': {
        const { data: sessions, error: sErr } = await admin
          .from('expert_ai_training_sessions')
          .select('id, week_start, status, ai_questions, answers, suggested_knowledge, suggested_journal_edits, revisions, started_at, completed_at, created_at, updated_at')
          .eq('expert_id', expertId)
          .order('week_start', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(200);
        if (sErr) throw sErr;
        const ids = (sessions || []).map((s) => s.id);
        // 每 session 已核可 / 已退回 / pending 條目數
        const counts = new Map<string, { approved: number; pending: number; rejected: number }>();
        if (ids.length > 0) {
          const { data: chunks } = await admin
            .from('expert_knowledge_chunks')
            .select('training_session_id, status')
            .eq('expert_id', expertId)
            .in('training_session_id', ids);
          for (const c of chunks || []) {
            const tid = c.training_session_id as string;
            if (!tid) continue;
            const cur = counts.get(tid) || { approved: 0, pending: 0, rejected: 0 };
            if (c.status === 'approved') cur.approved += 1;
            else if (c.status === 'rejected') cur.rejected += 1;
            else cur.pending += 1;
            counts.set(tid, cur);
          }
        }
        return jsonResponse({
          ok: true,
          sessions: (sessions || []).map((s) => {
            const questions = Array.isArray(s.ai_questions) ? s.ai_questions.length : 0;
            const answers = Array.isArray(s.answers) ? (s.answers as any[]).filter((a) => (a?.answer || '').trim()).length : 0;
            const suggested = Array.isArray(s.suggested_knowledge) ? s.suggested_knowledge.length : 0;
            const c = counts.get(s.id) || { approved: 0, pending: 0, rejected: 0 };
            return {
              id: s.id,
              week_start: s.week_start,
              status: s.status,
              started_at: s.started_at,
              completed_at: s.completed_at,
              updated_at: s.updated_at,
              question_count: questions,
              answered_count: answers,
              suggested_count: suggested,
              accepted_count: c.approved,
              rejected_count: c.rejected,
              accepted_pending_count: c.pending,
              revision_count: Array.isArray(s.revisions) ? s.revisions.length : 0,
            };
          }),
        });
      }

      case 'get_session':
      case 'get_session_detail': {
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        const { data: session } = await admin.from('expert_ai_training_sessions').select('*').eq('id', id).eq('expert_id', expertId).maybeSingle();
        if (!session) return jsonResponse({ ok: true, session: null });
        if (action === 'get_session') return jsonResponse({ ok: true, session });

        // detail：帶入該週已發佈週記 + 由此 session 產生的 chunks
        const { startIso, endIso } = taipeiWeekRangeUtc(session.week_start);
        const [{ data: signals }, { data: acceptedChunks }] = await Promise.all([
          admin.from('expert_signals')
            .select('id, instrument, action, published_at, reason_summary, reason_detail, risk_notes, learning_points, overall_summary')
            .eq('expert_id', expertId)
            .eq('status', 'published')
            .gte('published_at', startIso)
            .lt('published_at', endIso)
            .order('published_at', { ascending: true }),
          admin.from('expert_knowledge_chunks')
            .select('id, title, content, status, source_type, metadata, created_at, reviewed_at')
            .eq('expert_id', expertId)
            .eq('training_session_id', id)
            .order('created_at', { ascending: false }),
        ]);
        return jsonResponse({
          ok: true,
          session,
          signals: signals || [],
          accepted_chunks: acceptedChunks || [],
        });
      }


      case 'start_session': {
        const weekStart = body.week_start as string;
        if (!weekStart) return errorResponse('week_start required', 400);

        // 已有 session？回傳；若是 discarded 允許重跑
        const { data: existing } = await admin.from('expert_ai_training_sessions').select('*').eq('expert_id', expertId).eq('week_start', weekStart).maybeSingle();
        if (existing && existing.status !== 'discarded' && Array.isArray(existing.ai_questions) && existing.ai_questions.length > 0) {
          return jsonResponse({ ok: true, session: existing, reused: true });
        }

        // 抓該週已發佈 signals
        const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
        const { data: signals } = await admin
          .from('expert_signals')
          .select('id, instrument, action, published_at, reason_summary, reason_detail, risk_notes, learning_points, overall_summary')
          .eq('expert_id', expertId)
          .eq('status', 'published')
          .gte('published_at', startIso)
          .lt('published_at', endIso)
          .order('published_at', { ascending: true });

        if (!signals || signals.length === 0) return errorResponse('本週沒有已發佈的週記可訓練', 400);

        const journalText = signals.map(fmtSignalBlock).join('\n\n---\n\n');
        const { model, persona } = await getModel();

        const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY, undefined, { structuredOutputs: true });
        const systemLines = [
          '你是一個協助投資導師「精煉觀點」的訓練助理。',
          '任務：讀完該導師本週的週記後，提出 3–5 個「補完題」，逼老師講清楚未寫透的觀點、風險假設、標的邏輯或情境依賴。',
          '問題要具體、可回答、避免空泛（不要「你怎麼看市場」這種）。',
          '每題請附上「為什麼要問」的一句話理由，讓老師知道這題會補上哪塊空白。',
          persona?.system_prompt ? `導師人設：${persona.system_prompt}` : '',
        ].filter(Boolean).join('\n');

        let questions: Array<{ id: string; question: string; rationale: string }> = [];
        try {
          const res = await generateText({
            model: gateway(model),
            system: systemLines,
            prompt: `本週已發佈週記：\n\n${journalText}\n\n請產出 3–5 個補完題。`,
            output: Output.object({
              schema: z.object({
                questions: z.array(z.object({ question: z.string(), rationale: z.string() })),
              }),
            }),
          });
          const arr = (res.output?.questions || []).slice(0, 6);
          questions = arr.map((q, i) => ({ id: `q${i + 1}`, question: q.question, rationale: q.rationale }));
        } catch (e) {
          const msg = (e as Error).message;
          log.error('gen_questions_failed', { err: msg });
          return errorResponse('AI 生成補完題失敗：' + msg, 500, { requestId: log.requestId, stage: 'gen_questions', action: 'start_session' });
        }

        const patch = {
          expert_id: expertId,
          week_start: weekStart,
          signal_id: signals[0]?.id ?? null,
          status: 'open',
          ai_questions: questions,
          answers: existing?.answers ?? [],
          suggested_knowledge: [],
          suggested_journal_edits: [],
          started_at: new Date().toISOString(),
        };

        let session;
        if (existing) {
          const { data } = await admin.from('expert_ai_training_sessions').update(patch).eq('id', existing.id).select().maybeSingle();
          session = data;
        } else {
          const { data } = await admin.from('expert_ai_training_sessions').insert(patch).select().maybeSingle();
          session = data;
        }
        return jsonResponse({ ok: true, session });
      }

      case 'save_answers': {
        const id = body.id as string;
        const answers = body.answers;
        if (!id || !Array.isArray(answers)) return errorResponse('id and answers required', 400);
        const { data: cur } = await admin.from('expert_ai_training_sessions').select('status').eq('id', id).eq('expert_id', expertId).maybeSingle();
        if (!cur) return errorResponse('session not found', 404);
        if (cur.status === 'completed') return errorResponse('session 已完成，無法再修改答覆', 400);
        const { data, error } = await admin.from('expert_ai_training_sessions').update({ answers }).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (error) throw error;
        return jsonResponse({ ok: true, session: data });
      }

      case 'regenerate_questions': {
        // 快照當前題目/答覆/候選 → 重新生成補完題（保留 answers 供老師接續填）
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        const { data: cur } = await admin.from('expert_ai_training_sessions').select('*').eq('id', id).eq('expert_id', expertId).maybeSingle();
        if (!cur) return errorResponse('session not found', 404);
        if (cur.status === 'completed') return errorResponse('session 已完成，無法重新產題', 400);

        const { startIso, endIso } = taipeiWeekRangeUtc(cur.week_start);
        const { data: signals } = await admin
          .from('expert_signals')
          .select('id, instrument, action, published_at, reason_summary, reason_detail, risk_notes, learning_points, overall_summary')
          .eq('expert_id', expertId)
          .eq('status', 'published')
          .gte('published_at', startIso)
          .lt('published_at', endIso)
          .order('published_at', { ascending: true });
        if (!signals || signals.length === 0) return errorResponse('本週已無可訓練的週記', 400);

        const journalText = signals.map(fmtSignalBlock).join('\n\n---\n\n');
        const { model, persona } = await getModel();
        const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY, undefined, { structuredOutputs: true });

        let questions: Array<{ id: string; question: string; rationale: string }> = [];
        try {
          const res = await generateText({
            model: gateway(model),
            system: [
              '你是一個協助投資導師「精煉觀點」的訓練助理。',
              '任務：讀完該導師本週的週記後，提出 3–5 個「補完題」，逼老師講清楚未寫透的觀點、風險假設、標的邏輯或情境依賴。',
              '請避免與上一輪重複的角度，嘗試切入不同面向（例如：情境依賴、時間軸、風險假設、退場條件）。',
              '每題請附上「為什麼要問」的一句話理由。',
              persona?.system_prompt ? `導師人設：${persona.system_prompt}` : '',
            ].filter(Boolean).join('\n'),
            prompt: `本週已發佈週記：\n\n${journalText}\n\n上一輪提出的題目（請不要重複，換角度）：\n${(cur.ai_questions as any[] || []).map((q: any, i: number) => `${i + 1}. ${q.question}`).join('\n')}\n\n請產出 3–5 個新的補完題。`,
            output: Output.object({
              schema: z.object({
                questions: z.array(z.object({ question: z.string(), rationale: z.string() })),
              }),
            }),
          });
          const arr = (res.output?.questions || []).slice(0, 6);
          questions = arr.map((q, i) => ({ id: `q${i + 1}`, question: q.question, rationale: q.rationale }));
        } catch (e) {
          const msg = (e as Error).message;
          log.error('regen_questions_failed', { err: msg });
          return errorResponse('AI 重新產題失敗：' + msg, 500, { requestId: log.requestId, stage: 'regen_questions', action: 'regenerate_questions' });
        }

        const nextRev = [
          ...(Array.isArray(cur.revisions) ? cur.revisions : []),
          {
            revision: (Array.isArray(cur.revisions) ? cur.revisions.length : 0) + 1,
            action: 'regenerate_questions',
            snapshotted_at: new Date().toISOString(),
            triggered_by: uid,
            ai_questions: cur.ai_questions ?? [],
            answers: cur.answers ?? [],
            suggested_knowledge: cur.suggested_knowledge ?? [],
            suggested_journal_edits: cur.suggested_journal_edits ?? [],
          },
        ];
        const { data, error: upErr } = await admin.from('expert_ai_training_sessions').update({
          ai_questions: questions,
          // 保留 answers；老師可能想沿用回覆再補題
          answers: cur.answers ?? [],
          // 題目變了，先清空舊候選，避免與新題不一致
          suggested_knowledge: [],
          suggested_journal_edits: [],
          status: 'open',
          revisions: nextRev,
        }).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (upErr) throw upErr;
        return jsonResponse({ ok: true, session: data, revision: nextRev.length });
      }

      case 'generate_suggestions':
      case 'regenerate_suggestions': {
        // regenerate_suggestions：先把當前 suggested_* 快照進 revisions[]，再重跑一次
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        const { data: session } = await admin.from('expert_ai_training_sessions').select('*').eq('id', id).eq('expert_id', expertId).maybeSingle();
        if (!session) return errorResponse('session not found', 404);
        if (session.status === 'completed') return errorResponse('session 已完成，無法重跑', 400);
        const isRegen = action === 'regenerate_suggestions';

        const weekStart = session.week_start;
        const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
        const { data: signals } = await admin
          .from('expert_signals')
          .select('id, instrument, action, published_at, reason_summary, reason_detail, risk_notes, learning_points, overall_summary')
          .eq('expert_id', expertId)
          .eq('status', 'published')
          .gte('published_at', startIso)
          .lt('published_at', endIso);

        const journalText = (signals || []).map(fmtSignalBlock).join('\n\n---\n\n');
        const qas = (session.ai_questions as any[]).map((q, i) => {
          const a = (session.answers as any[])?.[i]?.answer || (session.answers as any[])?.find?.((x: any) => x?.id === q.id)?.answer || '';
          return `Q: ${q.question}\nA: ${a}`;
        }).join('\n\n');

        const { model, persona } = await getModel();
        const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY, undefined, { structuredOutputs: true });

        let suggestedKnowledge: Array<{ id: string; title: string; content: string; source: string }> = [];
        let suggestedJournalEdits: Array<{ id: string; area: string; suggestion: string }> = [];
        try {
          const res = await generateText({
            model: gateway(model),
            system: [
              '你是投資導師的觀點整理助理。根據導師本週週記＋補完題答覆，做兩件事：',
              '1) 產出「候選知識條目」：每條 60–300 字，第一人稱、可獨立閱讀，日後 AI 分身回答訂閱者時能引用。',
              '2) 產出「週記完善建議」：具體指出週記哪段可補、要補什麼、為什麼。',
              '避免重複週記已寫過的內容。用導師本人語氣。',
              persona?.system_prompt ? `導師人設：${persona.system_prompt}` : '',
            ].filter(Boolean).join('\n'),
            prompt: `本週週記：\n${journalText}\n\n補完題與回覆：\n${qas}\n\n請產出候選知識條目（3–8 條）與週記完善建議（0–5 條）。`,
            output: Output.object({
              schema: z.object({
                knowledge: z.array(z.object({ title: z.string(), content: z.string(), source: z.string() })),
                journal_edits: z.array(z.object({ area: z.string(), suggestion: z.string() })),
              }),
            }),
          });
          suggestedKnowledge = (res.output?.knowledge || []).map((k, i) => ({ id: `k${i + 1}`, ...k }));
          suggestedJournalEdits = (res.output?.journal_edits || []).map((j, i) => ({ id: `e${i + 1}`, ...j }));
        } catch (e) {
          const msg = (e as Error).message;
          log.error('gen_suggestions_failed', { err: msg, isRegen });
          return errorResponse('AI 產出候選條目失敗：' + msg, 500, { requestId: log.requestId, stage: isRegen ? 'regen_suggestions' : 'gen_suggestions', action });
        }

        const patch: Record<string, unknown> = {
          suggested_knowledge: suggestedKnowledge,
          suggested_journal_edits: suggestedJournalEdits,
          status: 'reviewing',
        };
        if (isRegen) {
          const revs = Array.isArray(session.revisions) ? session.revisions : [];
          patch.revisions = [
            ...revs,
            {
              revision: revs.length + 1,
              action: 'regenerate_suggestions',
              snapshotted_at: new Date().toISOString(),
              triggered_by: uid,
              ai_questions: session.ai_questions ?? [],
              answers: session.answers ?? [],
              suggested_knowledge: session.suggested_knowledge ?? [],
              suggested_journal_edits: session.suggested_journal_edits ?? [],
            },
          ];
        }
        const { data, error: upErr } = await admin.from('expert_ai_training_sessions').update(patch).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (upErr) throw upErr;
        return jsonResponse({ ok: true, session: data, revision: Array.isArray(patch.revisions) ? (patch.revisions as unknown[]).length : (Array.isArray(session.revisions) ? session.revisions.length : 0) });
      }

      case 'accept_knowledge': {
        const id = body.id as string;
        const items = body.items as Array<{ id?: string; title: string; content: string; source?: string }>;
        if (!id || !Array.isArray(items) || items.length === 0) return errorResponse('id and items required', 400);
        const { data: session } = await admin.from('expert_ai_training_sessions').select('id, expert_id, week_start, status').eq('id', id).eq('expert_id', expertId).maybeSingle();
        if (!session) return errorResponse('session not found', 404);
        if (session.status === 'completed') return errorResponse('session 已完成，無法再加入條目', 400);

        const inserted: any[] = [];
        const failed: Array<{ candidate_id: string | null; title: string; stage: 'validate' | 'embed' | 'insert'; error: string }> = [];
        for (const it of items) {
          const candId = it.id || null;
          const content = String(it.content || '').trim();
          if (!content) { failed.push({ candidate_id: candId, title: it.title || '(空)', stage: 'validate', error: 'content empty' }); continue; }
          let stage: 'embed' | 'insert' = 'embed';
          try {
            const vec = await embedText(LOVABLE_API_KEY, content);
            stage = 'insert';
            const { data, error: insErr } = await admin.from('expert_knowledge_chunks').insert({
              expert_id: expertId,
              source_type: 'training',
              source_id: null,
              content,
              title: it.title?.slice(0, 200) || null,
              embedding: `[${vec.join(',')}]`,
              metadata: { source: it.source || null, week_start: session.week_start, candidate_id: candId },
              is_manual: true,
              // 一律走 pending，讓所有訓練產物都經過「待審核」流程再進 RAG
              status: 'pending',
              created_by: uid,
              reviewed_by: null,
              reviewed_at: null,
              training_session_id: session.id,
            }).select().maybeSingle();
            if (insErr) throw insErr;
            if (data) inserted.push(data);
          } catch (e) {
            const msg = (e as Error).message;
            failed.push({ candidate_id: candId, title: it.title || '(空)', stage, error: msg });
            log.error('accept_embed_failed', { candidateId: candId, stage, err: msg });
          }
        }
        return jsonResponse({ ok: true, inserted_count: inserted.length, failed, requestId: log.requestId });
      }

      case 'complete_session': {
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        const { data, error } = await admin.from('expert_ai_training_sessions').update({
          status: 'completed', completed_at: new Date().toISOString(),
        }).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (error) throw error;
        return jsonResponse({ ok: true, session: data });
      }

      case 'discard_session': {
        const id = body.id as string;
        if (!id) return errorResponse('id required', 400);
        const { data, error } = await admin.from('expert_ai_training_sessions').update({ status: 'discarded' }).eq('id', id).eq('expert_id', expertId).select().maybeSingle();
        if (error) throw error;
        return jsonResponse({ ok: true, session: data });
      }

      default:
        return errorResponse('unknown action: ' + action, 400);
    }
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    log.error('training_failed', { action, err: msg });
    return errorResponse(msg, 500, { requestId: log.requestId, action });
  }
}));
