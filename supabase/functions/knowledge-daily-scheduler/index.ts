// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
// 知識庫每日排程：跑回測 → 套門檻分流 → rescue 池網格搶救 → candidate 觀察期升降級
// 由 pg_cron 每日 03:00 (Asia/Taipei) 觸發
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface Rules {
  enabled: boolean
  archive_below_win_rate: number
  promote_above_win_rate: number
  min_sample_size: number
  auto_grid_search_below: number
  promote_min_improvement_pct: number
  daily_grid_search_quota: number
  rescue_max_weeks: number
  candidate_observe_days: number
}

async function logAudit(supa: any, action: string, payload: any) {
  try {
    await supa.from('audit_logs').insert({
      action,
      target_type: 'knowledge_item',
      target_id: payload?.target_id ?? null,
      detail: { context: payload, source: 'knowledge-daily-scheduler' },
    })
  } catch (_) { /* noop */ }
}

async function callBacktest(itemId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/knowledge-backtest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ mode: 'single', item_id: itemId }),
  })
  if (!res.ok) throw new Error(`backtest ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function callGridSearch(itemId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/knowledge-backtest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ mode: 'grid_search', item_id: itemId }),
  })
  if (!res.ok) throw new Error(`grid ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

Deno.serve(withLogging('knowledge-daily-scheduler', async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supa = serviceClient()
  const summary: Record<string, any> = {
    started_at: new Date().toISOString(),
    backtested: 0, promoted: 0, demoted_rescue: 0, rescue_grid_run: 0,
    candidate_promoted: 0, candidate_archived: 0, rescue_archived: 0,
    errors: [] as any[],
  }

  try {
    const { data: rulesRow } = await supa.from('knowledge_auto_rules').select('*').limit(1).maybeSingle()
    const rules: Rules = (rulesRow ?? {
      enabled: false,
      archive_below_win_rate: 0.4, promote_above_win_rate: 0.7,
      min_sample_size: 30, auto_grid_search_below: 0.55,
      promote_min_improvement_pct: 5,
      daily_grid_search_quota: 5, rescue_max_weeks: 3, candidate_observe_days: 14,
    }) as Rules

    if (!rules.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: 'rules disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ========== Step 1: backtest items needing refresh ==========
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
    const { data: needBacktest } = await supa
      .from('checkup_knowledge_items')
      .select('id,item_id,sample_size,backtest_run_at,backtestable,lifecycle_status')
      .eq('backtestable', true)
      .in('lifecycle_status', ['active', 'rescue'])
      .or(`sample_size.lt.${rules.min_sample_size},backtest_run_at.is.null,backtest_run_at.lt.${sevenDaysAgo}`)
      .limit(20)

    for (const it of needBacktest ?? []) {
      try {
        await callBacktest(it.id)
        summary.backtested++
      } catch (e: any) {
        summary.errors.push({ step: 'backtest', item_id: it.item_id, msg: String(e?.message ?? e) })
      }
    }

    // ========== Step 2: apply thresholds → split into pools ==========
    const { data: actives } = await supa
      .from('checkup_knowledge_items')
      .select('id,item_id,win_rate,sample_size,lifecycle_status,confidence')
      .in('lifecycle_status', ['active', 'rescue'])

    for (const it of actives ?? []) {
      if ((it.sample_size ?? 0) < rules.min_sample_size) continue
      const wr = Number(it.win_rate ?? 0)

      if (wr >= rules.promote_above_win_rate && it.lifecycle_status !== 'active') {
        await supa.from('checkup_knowledge_items').update({
          lifecycle_status: 'active', rescue_started_at: null, rescue_attempts: 0,
        }).eq('id', it.id)
        summary.promoted++
        await logAudit(supa, 'knowledge.auto_promote_active', { target_id: it.id, item_id: it.item_id, win_rate: wr, sample_size: it.sample_size })
      } else if (wr < rules.auto_grid_search_below && it.lifecycle_status === 'active') {
        await supa.from('checkup_knowledge_items').update({
          lifecycle_status: 'rescue', rescue_started_at: new Date().toISOString(),
        }).eq('id', it.id)
        summary.demoted_rescue++
        await logAudit(supa, 'knowledge.auto_demote_rescue', { target_id: it.id, item_id: it.item_id, win_rate: wr, sample_size: it.sample_size, threshold: rules.auto_grid_search_below })
      }
    }

    // ========== Step 3: run grid search on rescue pool (quota-limited) ==========
    const { data: rescueItems } = await supa
      .from('checkup_knowledge_items')
      .select('id,item_id,rescue_started_at,rescue_attempts')
      .eq('lifecycle_status', 'rescue')
      .order('rescue_attempts', { ascending: true })
      .order('rescue_started_at', { ascending: true })
      .limit(rules.daily_grid_search_quota)

    for (const it of rescueItems ?? []) {
      try {
        const res = await callGridSearch(it.id)
        await supa.from('checkup_knowledge_items')
          .update({ rescue_attempts: (it.rescue_attempts ?? 0) + 1 })
          .eq('id', it.id)
        summary.rescue_grid_run++
        await logAudit(supa, 'knowledge.auto_grid_search', {
          target_id: it.id, item_id: it.item_id,
          attempts: (it.rescue_attempts ?? 0) + 1,
          best_win_rate: res?.best_win_rate ?? null,
          improvement_pct: res?.improvement_pct ?? null,
          created_candidate_id: res?.created_candidate_id ?? null,
        })
        if (res?.created_candidate_id) {
          await supa.from('checkup_knowledge_items').update({
            lifecycle_status: 'candidate',
            candidate_observed_since: new Date().toISOString(),
          }).eq('id', res.created_candidate_id)
          await logAudit(supa, 'knowledge.candidate_created', {
            target_id: res.created_candidate_id, parent_id: it.id, parent_item_id: it.item_id,
          })
        }
      } catch (e: any) {
        summary.errors.push({ step: 'grid', item_id: it.item_id, msg: String(e?.message ?? e) })
      }
    }

    // ========== Step 3b: rescue pool too long → archive ==========
    const rescueDeadline = new Date(Date.now() - rules.rescue_max_weeks * 7 * 86400_000).toISOString()
    const { data: tooLong } = await supa
      .from('checkup_knowledge_items')
      .select('id,item_id')
      .eq('lifecycle_status', 'rescue')
      .lt('rescue_started_at', rescueDeadline)

    for (const it of tooLong ?? []) {
      await supa.from('checkup_knowledge_items').update({
        lifecycle_status: 'archived',
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_reason: `rescue_failed_${rules.rescue_max_weeks}w`,
      }).eq('id', it.id)
      summary.rescue_archived++
      await logAudit(supa, 'knowledge.auto_archive_rescue', { target_id: it.id, item_id: it.item_id, reason: 'rescue_failed_max_weeks', max_weeks: rules.rescue_max_weeks })
    }

    // ========== Step 4: candidate observation period ==========
    const candDeadline = new Date(Date.now() - rules.candidate_observe_days * 86400_000).toISOString()
    const { data: candidates } = await supa
      .from('checkup_knowledge_items')
      .select('id,item_id,win_rate,sample_size,parent_item_id,candidate_observed_since')
      .eq('lifecycle_status', 'candidate')
      .lt('candidate_observed_since', candDeadline)

    for (const cand of candidates ?? []) {
      const wr = Number(cand.win_rate ?? 0)
      if ((cand.sample_size ?? 0) < rules.min_sample_size) continue

      // 比較 parent
      let parentWr = 0
      if (cand.parent_item_id) {
        const { data: parent } = await supa
          .from('checkup_knowledge_items')
          .select('win_rate').eq('id', cand.parent_item_id).maybeSingle()
        parentWr = Number(parent?.win_rate ?? 0)
      }

      if (wr >= parentWr) {
        await supa.from('checkup_knowledge_items').update({
          lifecycle_status: 'active', candidate_observed_since: null,
        }).eq('id', cand.id)
        if (cand.parent_item_id) {
          await supa.from('checkup_knowledge_items').update({
            lifecycle_status: 'archived',
            is_active: false,
            archived_at: new Date().toISOString(),
            archived_reason: 'replaced_by_candidate',
          }).eq('id', cand.parent_item_id)
        }
        summary.candidate_promoted++
        await logAudit(supa, 'knowledge.auto_promote_candidate', { target_id: cand.id, item_id: cand.item_id, win_rate: wr, parent_win_rate: parentWr, sample_size: cand.sample_size })
      } else {
        await supa.from('checkup_knowledge_items').update({
          lifecycle_status: 'archived',
          is_active: false,
          archived_at: new Date().toISOString(),
          archived_reason: 'candidate_underperformed',
        }).eq('id', cand.id)
        summary.candidate_archived++
        await logAudit(supa, 'knowledge.auto_archive_candidate', { target_id: cand.id, item_id: cand.item_id, win_rate: wr, parent_win_rate: parentWr, reason: 'underperformed' })
      }
    }

    summary.finished_at = new Date().toISOString()
    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e), summary }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
