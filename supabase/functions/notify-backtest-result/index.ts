// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationJsonResponse } from '../_shared/inputValidator.ts';
// 回測完成通知（Email 版）：彙整最近 N 小時的 knowledge_backtest_runs，
// 透過 Resend 寄信給所有 company_admin。
// Body: { hours?: number = 2, trigger?: 'cron' | 'manual' | 'auto_after_backfill' | 'auto' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDR = 'WiseTraders <noreply@wisetraders.tw>'

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(1)}%`
}

function buildEmail(s: {
  total: number
  success: number
  failed: number
  trigger: string
  topGainers: Array<{ title: string; prevWr: number | null; newWr: number | null; n: number }>
  topLosers: Array<{ title: string; prevWr: number | null; newWr: number | null; n: number }>
  failures: Array<{ title: string; reason: string }>
  monitorUrl: string
}): { subject: string; html: string } {
  const ok = s.failed === 0
  const triggerLabel =
    s.trigger === 'cron' ? '每晚自動' :
    s.trigger === 'auto_after_backfill' ? '回填完成自動' :
    s.trigger === 'manual' ? '手動觸發' : s.trigger

  const subject = ok
    ? `✅ 回測完成（${triggerLabel}）— 成功 ${s.success} 筆`
    : `⚠️ 回測完成・有 ${s.failed} 筆失敗（${triggerLabel}）`

  const headerColor = ok ? '#198754' : '#DC3545'

  const row = (label: string, val: string, color = '#333') =>
    `<tr><td style="padding:6px 0;color:#999;font-size:13px">${label}</td>
     <td style="padding:6px 0;text-align:right;font-weight:bold;color:${color};font-size:13px">${val}</td></tr>`

  let body = ''
  body += `<table width="100%" style="border-collapse:collapse;margin:12px 0">`
  body += row('總計', String(s.total))
  body += row('成功', String(s.success), '#198754')
  body += row('失敗', String(s.failed), s.failed ? '#DC3545' : '#999')
  body += `</table>`

  if (s.topGainers.length) {
    body += `<h3 style="font-size:14px;color:#333;margin:18px 0 8px">📈 勝率提升 Top</h3><ul style="margin:0;padding-left:18px;color:#444;font-size:13px;line-height:1.7">`
    for (const g of s.topGainers) {
      body += `<li>${g.title}：${fmtPct(g.prevWr)} → <b>${fmtPct(g.newWr)}</b>（n=${g.n}）</li>`
    }
    body += `</ul>`
  }
  if (s.topLosers.length) {
    body += `<h3 style="font-size:14px;color:#333;margin:18px 0 8px">📉 勝率下降 Top</h3><ul style="margin:0;padding-left:18px;color:#444;font-size:13px;line-height:1.7">`
    for (const g of s.topLosers) {
      body += `<li>${g.title}：${fmtPct(g.prevWr)} → <b>${fmtPct(g.newWr)}</b>（n=${g.n}）</li>`
    }
    body += `</ul>`
  }
  if (s.failures.length) {
    body += `<h3 style="font-size:14px;color:#DC3545;margin:18px 0 8px">❌ 失敗原因</h3><ul style="margin:0;padding-left:18px;color:#666;font-size:12px;line-height:1.6">`
    for (const f of s.failures.slice(0, 10)) {
      body += `<li><b>${f.title}</b>：${f.reason}</li>`
    }
    body += `</ul>`
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ef;font-family:-apple-system,'Helvetica Neue',sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;padding:0">
  <div style="background:${headerColor}15;padding:18px 24px;border-bottom:1px solid #eee">
    <div style="font-size:16px;font-weight:bold;color:${headerColor}">${subject}</div>
  </div>
  <div style="padding:18px 24px;color:#333">
    ${body}
    <div style="margin:24px 0 8px"><a href="${s.monitorUrl}" style="display:inline-block;padding:10px 18px;background:#333;color:#fff;text-decoration:none;border-radius:4px;font-size:13px">開啟監控頁</a></div>
  </div>
  <div style="padding:14px 24px;color:#aaa;font-size:11px;border-top:1px solid #eee">WiseTraders · 知識庫回測通知</div>
</div></body></html>`

  return { subject, html }
}

Deno.serve(withLogging('notify-backtest-result', async (req) => {
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

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const issues = validateInput({
      fields: {
        hours: { required: false, type: 'number', acceptTypes: ['string'], label: 'hours' },
        trigger: { required: false, type: 'string', label: 'trigger', oneOf: ['cron', 'manual', 'auto_after_backfill', 'auto'] },
      },
      source: body,
    })
    if (issues.length) return validationJsonResponse(issues)
    const hours = Math.max(1, Math.min(72, Number(body.hours ?? 2)))
    const trigger = String(body.trigger ?? 'cron')

    const sb = serviceClient()
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()

    const { data: runs } = await sb
      .from('knowledge_backtest_runs')
      .select('id, knowledge_item_id, status, win_rate, total_hits, error_message, run_mode, completed_at')
      .gte('created_at', since)
      .neq('run_mode', 'grid_search')
      .order('completed_at', { ascending: false })
      .limit(500)

    const allRuns = runs ?? []
    if (allRuns.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no_runs', hours }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const success = allRuns.filter(r => r.status === 'completed').length
    const failed = allRuns.filter(r => r.status === 'failed').length

    const itemIds = Array.from(new Set(allRuns.map(r => r.knowledge_item_id).filter(Boolean)))
    const { data: items } = await sb
      .from('checkup_knowledge_items')
      .select('id, title, win_rate, sample_size')
      .in('id', itemIds)
    const itemMap = new Map<string, any>()
    for (const it of items ?? []) itemMap.set(it.id, it)

    const itemRuns = new Map<string, any[]>()
    for (const r of allRuns) {
      if (!r.knowledge_item_id) continue
      if (!itemRuns.has(r.knowledge_item_id)) itemRuns.set(r.knowledge_item_id, [])
      itemRuns.get(r.knowledge_item_id)!.push(r)
    }

    const deltas: Array<{ id: string; title: string; prevWr: number | null; newWr: number | null; n: number; delta: number }> = []
    for (const [id, list] of itemRuns) {
      const completed = list.filter(r => r.status === 'completed')
      if (completed.length === 0) continue
      const latest = completed[0]
      const { data: prev } = await sb
        .from('knowledge_backtest_runs')
        .select('win_rate')
        .eq('knowledge_item_id', id)
        .eq('status', 'completed')
        .neq('run_mode', 'grid_search')
        .lt('completed_at', latest.completed_at)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const prevWr = prev?.win_rate != null ? Number(prev.win_rate) : null
      const newWr = latest.win_rate != null ? Number(latest.win_rate) : null
      if (prevWr != null && newWr != null) {
        deltas.push({
          id, title: itemMap.get(id)?.title ?? id.slice(0, 8),
          prevWr, newWr, n: latest.total_hits ?? 0,
          delta: newWr - prevWr,
        })
      }
    }
    deltas.sort((a, b) => b.delta - a.delta)
    const topGainers = deltas.filter(d => d.delta > 0.005).slice(0, 5)
    const topLosers = deltas.filter(d => d.delta < -0.005).slice(-5).reverse()

    const failures = allRuns
      .filter(r => r.status === 'failed')
      .slice(0, 10)
      .map(r => ({
        title: itemMap.get(r.knowledge_item_id)?.title ?? r.knowledge_item_id?.slice(0, 8) ?? '(unknown)',
        reason: (r.error_message ?? 'unknown').slice(0, 160),
      }))

    // 收件人：所有 company_admin 的 email
    const { data: adminRoles } = await sb
      .from('user_roles').select('user_id').eq('role', 'company_admin')
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id)

    const recipients: string[] = []
    for (const uid of adminIds) {
      const { data: u } = await sb.auth.admin.getUserById(uid)
      const email = u?.user?.email
      if (email && !email.endsWith('@line.local')) recipients.push(email)
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({
        ok: true, skipped: 'no_admin_email', total: allRuns.length, success, failed,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const monitorUrl = `${Deno.env.get('SITE_URL') || 'https://legendflow.tw'}/company/backtest-monitor`
    const { subject, html } = buildEmail({
      total: allRuns.length, success, failed, trigger,
      topGainers, topLosers, failures, monitorUrl,
    })

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let sent = 0
    let failedSend = 0
    const errors: string[] = []
    for (const to of recipients) {
      try {
        const res = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: FROM_ADDR, to: [to], subject, html }),
        })
        if (res.ok) sent++
        else {
          failedSend++
          const t = await res.text()
          const msg = `${to}: HTTP ${res.status} ${t.slice(0, 180)}`
          errors.push(msg)
          console.error('Resend failed', msg)
        }
      } catch (e) {
        failedSend++
        const msg = `${to}: ${String(e).slice(0, 180)}`
        errors.push(msg)
        console.error('Resend error', msg)
      }
    }

    // 寫入 function_run_logs 供監控頁顯示
    try {
      await sb.from('function_run_logs').insert({
        fn: 'notify-backtest-result',
        run_id: crypto.randomUUID(),
        level: failedSend > 0 ? 'error' : 'info',
        msg: `sent=${sent} failed=${failedSend} recipients=${recipients.length}`,
        payload: {
          email_sent: sent, email_failed: failedSend,
          recipients: recipients.length,
          total: allRuns.length, success, failed,
          trigger, errors: errors.slice(0, 10),
        },
      })
    } catch (e) { console.error('log insert failed:', e) }

    return new Response(JSON.stringify({
      ok: true, total: allRuns.length, success, failed,
      email_sent: sent, email_failed: failedSend,
      recipients: recipients.length, errors,
      gainers: topGainers.length, losers: topLosers.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('notify-backtest-result error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
