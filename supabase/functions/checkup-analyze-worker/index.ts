// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 背景 worker：讀 job.prompts_payload，依序呼叫 checkup-analyze 三次
// 保存 raw_responses + 簡易 result_summary，最後觸發 checkup-notify-complete
// 僅接受 service_role 觸發
import { corsPreflight, jsonResponse } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const HARD_TIMEOUT_MS = 5 * 60 * 1000;

async function callAnalyze(supabaseUrl: string, serviceKey: string, body: any, timeoutMs: number): Promise<{ ok: boolean; text: string; error?: string }> {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/checkup-analyze`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return { ok: false, text: '', error: `HTTP ${r.status}: ${errText.slice(0, 300)}` };
    }
    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: '', error: String(e).slice(0, 300) };
  }
}

function safeParseJson(text: string): any {
  if (!text) return null;
  const clean = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch { /* */ }
  // try first {...} or [...] block
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch { /* */ } }
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch { /* */ } }
  return null;
}

function extractInlineBlocks(mainText: string): { brainRaw: any | null; eventAssessments: any[] | null } {
  let brainRaw: any = null;
  let eventAssessments: any[] | null = null;
  try {
    const eventMatch = mainText.match(/## 📋 EVENT_ASSESSMENTS([\s\S]*?)(?=## 🧬 BRAIN_UPDATE|$)/);
    if (eventMatch) {
      const parsed = safeParseJson(eventMatch[1]);
      if (Array.isArray(parsed)) eventAssessments = parsed;
    }
    const brainMatch = mainText.match(/## 🧬 BRAIN_UPDATE([\s\S]*?)$/);
    if (brainMatch) {
      const parsed = safeParseJson(brainMatch[1]);
      if (parsed && parsed.rules) brainRaw = parsed;
    }
  } catch { /* */ }
  return { brainRaw, eventAssessments };
}

function computeSummary(holdings: any[], mainText: string) {
  const total_pnl = (holdings || []).reduce((sum, h) => {
    const cost = Number(h?.cost) || 0;
    const price = Number(h?.price) || 0;
    const qty = Number(h?.qty) || 0;
    return sum + (price - cost) * qty;
  }, 0);

  // 嘗試從 AI 主回覆抓「需注意」段落（簡單啟發式）；失敗則 fallback 用持倉跌幅前三
  let watchlist: Array<{ code: string; name: string; note: string }> = [];
  try {
    const watchSection = mainText.match(/(?:需注意|關注|警示)[\s\S]{0,1500}/);
    if (watchSection) {
      const lines = watchSection[0].split('\n').slice(0, 30);
      for (const line of lines) {
        const m = line.match(/([\u4e00-\u9fa5A-Za-z0-9.\-]+)\s*[(（]\s*(\d{4,6})\s*[)）]/);
        if (m) {
          watchlist.push({ code: m[2], name: m[1], note: line.replace(/^[\s•\-*]+/, '').slice(0, 60) });
          if (watchlist.length >= 3) break;
        }
      }
    }
  } catch { /* */ }

  if (watchlist.length === 0) {
    const sorted = [...(holdings || [])].map((h) => ({
      code: String(h?.code || ''),
      name: String(h?.name || ''),
      pct: (Number(h?.price) && Number(h?.cost)) ? ((Number(h.price) - Number(h.cost)) / Number(h.cost)) * 100 : 0,
    })).filter((h) => h.code).sort((a, b) => a.pct - b.pct).slice(0, 3);
    watchlist = sorted.map((h) => ({ code: h.code, name: h.name, note: `報酬率 ${h.pct.toFixed(1)}%` }));
  }

  return {
    total_pnl: Math.round(total_pnl),
    total_holdings: (holdings || []).length,
    watchlist,
  };
}


const handler = withLogging('checkup-analyze-worker', async (req, log) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token !== SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const jobId = String(body?.job_id || '').trim();
  if (!jobId) return jsonResponse({ error: 'job_id is required' }, { status: 400 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: job, error: jobErr } = await admin
    .from('checkup_analysis_jobs').select('*').eq('id', jobId).maybeSingle();
  if (jobErr || !job) return jsonResponse({ error: 'JOB_NOT_FOUND' }, { status: 404 });
  if (job.status === 'done' || job.status === 'failed') {
    return jsonResponse({ ok: true, skipped: job.status });
  }

  await admin.from('checkup_analysis_jobs').update({ status: 'running' }).eq('id', jobId);

  const startTs = Date.now();
  const prompts = job.prompts_payload || {};
  const raw: Record<string, any> = {};

  // 1) 盲測（失敗不阻擋）
  if (prompts.blind) {
    const remain = HARD_TIMEOUT_MS - (Date.now() - startTs);
    const blind = await callAnalyze(SUPABASE_URL, SERVICE_ROLE_KEY, prompts.blind, Math.min(remain, 90_000));
    raw.blind = { ok: blind.ok, text: blind.text, error: blind.error };
  }

  // 2) 主分析（必跑）
  if (Date.now() - startTs > HARD_TIMEOUT_MS) {
    await admin.from('checkup_analysis_jobs').update({
      status: 'failed', error_text: 'timeout_before_main', finished_at: new Date().toISOString(), raw_responses: raw,
    }).eq('id', jobId);
    await fetch(`${SUPABASE_URL}/functions/v1/checkup-notify-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ job_id: jobId }),
    }).catch((e) => log.warn('notify_invoke_failed', { stage: 'timeout', err: String(e).slice(0, 200) }));
    return jsonResponse({ ok: false, error: 'timeout_before_main' });
  }
  const mainRemain = HARD_TIMEOUT_MS - (Date.now() - startTs);
  const main = await callAnalyze(SUPABASE_URL, SERVICE_ROLE_KEY, prompts.main, Math.min(mainRemain, 180_000));
  raw.main = { ok: main.ok, text: main.text, error: main.error };

  if (!main.ok || !main.text) {
    const summary = computeSummary(job.holdings_snapshot || [], '');
    await admin.from('checkup_analysis_jobs').update({
      status: 'failed',
      error_text: main.error || 'main_analysis_empty',
      finished_at: new Date().toISOString(),
      raw_responses: raw,
      result_summary: summary,
    }).eq('id', jobId);
    await fetch(`${SUPABASE_URL}/functions/v1/checkup-notify-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ job_id: jobId }),
    }).catch((e) => log.warn('notify_invoke_failed', { stage: 'main_failed', err: String(e).slice(0, 200) }));
    return jsonResponse({ ok: false, error: main.error });
  }

  // 解析 main.text 內嵌的 BRAIN_UPDATE / EVENT_ASSESSMENTS（前端深層連結會 ingest 並 merge）
  const inline = extractInlineBlocks(main.text);
  let brainRaw = inline.brainRaw;
  const eventAssessments = inline.eventAssessments;

  // 3) 大腦 fallback：若主回覆未夾帶 BRAIN_UPDATE 才另呼叫
  if (!brainRaw && prompts.brain && Date.now() - startTs < HARD_TIMEOUT_MS) {
    const brainRemain = HARD_TIMEOUT_MS - (Date.now() - startTs);
    const brain = await callAnalyze(SUPABASE_URL, SERVICE_ROLE_KEY, prompts.brain, Math.min(brainRemain, 90_000));
    raw.brain = { ok: brain.ok, text: brain.text, error: brain.error };
    if (brain.ok && brain.text) {
      const parsed = safeParseJson(brain.text);
      if (parsed && parsed.rules) brainRaw = parsed;
    }
  }

  const summary = {
    ...computeSummary(job.holdings_snapshot || [], main.text),
    brain_raw: brainRaw,
    event_assessments: eventAssessments,
    ai_insight: main.text,
  };
  await admin.from('checkup_analysis_jobs').update({
    status: 'done',
    finished_at: new Date().toISOString(),
    raw_responses: raw,
    result_summary: summary,
  }).eq('id', jobId);


  await fetch(`${SUPABASE_URL}/functions/v1/checkup-notify-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ job_id: jobId }),
  }).catch((e) => log.warn('notify_invoke_failed', { stage: 'done', err: String(e).slice(0, 200) }));

  return jsonResponse({ ok: true, job_id: jobId, summary });
});

Deno.serve(handler);
