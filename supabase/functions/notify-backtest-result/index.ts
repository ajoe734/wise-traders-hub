// 回測完成通知：彙整最近 N 小時的 knowledge_backtest_runs，
// 推 LINE Flex 給所有「有 LINE 綁定」的 company_admin。
// 觸發來源：knowledge-backtest（full 模式跑完）/ 手動 invoke。
// Body: { hours?: number = 2, trigger?: 'cron' | 'manual' | 'auto' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/push'

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(1)}%`
}

function buildFlex(summary: {
  total: number
  success: number
  failed: number
  trigger: string
  topGainers: Array<{ title: string; prevWr: number | null; newWr: number | null; n: number }>
  topLosers: Array<{ title: string; prevWr: number | null; newWr: number | null; n: number }>
  failures: Array<{ title: string; reason: string }>
  monitorUrl: string
}) {
  const ok = summary.failed === 0
  const headerColor = ok ? '#198754' : '#DC3545'
  const headerText = ok
    ? `✅ 回測完成（${summary.trigger === 'cron' ? '每晚自動' : '手動'}）`
    : `⚠️ 回測完成・有 ${summary.failed} 筆失敗`

  const body: any[] = [
    {
      type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: '總計', size: 'sm', color: '#999', flex: 2 },
        { type: 'text', text: `${summary.total}`, size: 'sm', color: '#333', weight: 'bold', align: 'end', flex: 1 },
      ],
    },
    {
      type: 'box', layout: 'horizontal', margin: 'sm', contents: [
        { type: 'text', text: '成功', size: 'sm', color: '#999', flex: 2 },
        { type: 'text', text: `${summary.success}`, size: 'sm', color: '#198754', weight: 'bold', align: 'end', flex: 1 },
      ],
    },
    {
      type: 'box', layout: 'horizontal', margin: 'sm', contents: [
        { type: 'text', text: '失敗', size: 'sm', color: '#999', flex: 2 },
        { type: 'text', text: `${summary.failed}`, size: 'sm', color: summary.failed ? '#DC3545' : '#999', weight: 'bold', align: 'end', flex: 1 },
      ],
    },
  ]

  if (summary.topGainers.length) {
    body.push({ type: 'separator', margin: 'lg' })
    body.push({ type: 'text', text: '📈 勝率提升 Top', size: 'sm', weight: 'bold', color: '#333', margin: 'lg' })
    for (const g of summary.topGainers) {
      body.push({
        type: 'text', size: 'xs', wrap: true, margin: 'sm', color: '#444',
        text: `${g.title}：${fmtPct(g.prevWr)} → ${fmtPct(g.newWr)}（n=${g.n}）`,
      })
    }
  }
  if (summary.topLosers.length) {
    body.push({ type: 'separator', margin: 'lg' })
    body.push({ type: 'text', text: '📉 勝率下降 Top', size: 'sm', weight: 'bold', color: '#333', margin: 'lg' })
    for (const g of summary.topLosers) {
      body.push({
        type: 'text', size: 'xs', wrap: true, margin: 'sm', color: '#444',
        text: `${g.title}：${fmtPct(g.prevWr)} → ${fmtPct(g.newWr)}（n=${g.n}）`,
      })
    }
  }
  if (summary.failures.length) {
    body.push({ type: 'separator', margin: 'lg' })
    body.push({ type: 'text', text: '❌ 失敗原因', size: 'sm', weight: 'bold', color: '#DC3545', margin: 'lg' })
    for (const f of summary.failures.slice(0, 5)) {
      body.push({
        type: 'text', size: 'xs', wrap: true, margin: 'sm', color: '#666',
        text: `${f.title}：${f.reason}`,
      })
    }
  }

  return {
    type: 'flex',
    altText: headerText,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: headerColor + '15', paddingAll: 'lg',
        contents: [{ type: 'text', text: headerText, weight: 'bold', size: 'md', color: headerColor }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'none', contents: body },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [{
          type: 'button', style: 'primary', height: 'sm', color: '#333333',
          action: { type: 'uri', label: '開啟監控頁', uri: summary.monitorUrl },
        }],
      },
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const hours = Math.max(1, Math.min(72, Number(body.hours ?? 2)))
    const trigger = String(body.trigger ?? 'cron')

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()

    // 抓最近 runs（排除 grid_search 子格子）
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

    // 抓 item title 做顯示
    const itemIds = Array.from(new Set(allRuns.map(r => r.knowledge_item_id).filter(Boolean)))
    const { data: items } = await sb
      .from('checkup_knowledge_items')
      .select('id, title, win_rate, sample_size')
      .in('id', itemIds)
    const itemMap = new Map<string, any>()
    for (const it of items ?? []) itemMap.set(it.id, it)

    // 計算 delta（同一 item 取最近一筆 vs item 當前 win_rate 不準，
    // 改：每個 item 在這個視窗內 prev = 該 item 倒數第二筆 completed）
    // 簡化：以 item 當前 win_rate 當 new；prev 從同 item 上一筆 completed 取
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
      // 抓上一筆 completed（視窗外都行）
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
    const topGainers = deltas.filter(d => d.delta > 0.005).slice(0, 3)
    const topLosers = deltas.filter(d => d.delta < -0.005).slice(-3).reverse()

    const failures = allRuns
      .filter(r => r.status === 'failed')
      .slice(0, 5)
      .map(r => ({
        title: itemMap.get(r.knowledge_item_id)?.title ?? r.knowledge_item_id?.slice(0, 8) ?? '(unknown)',
        reason: (r.error_message ?? 'unknown').slice(0, 120),
      }))

    // 找出 admin 的 LINE 綁定
    const { data: adminRoles } = await sb
      .from('user_roles').select('user_id').eq('role', 'company_admin')
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id)

    const { data: bindings } = await sb
      .from('member_line_bindings')
      .select('user_id, line_user_id, expert_id')
      .in('user_id', adminIds)
      .eq('is_active', true)

    if (!bindings || bindings.length === 0) {
      return new Response(JSON.stringify({
        ok: true, skipped: 'no_admin_bindings', total: allRuns.length, success, failed,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const channelIds = Array.from(new Set(bindings.map((b: any) => b.expert_id)))
    const { data: channels } = await sb
      .from('expert_line_channels')
      .select('expert_id, channel_access_token, is_active')
      .in('expert_id', channelIds)
      .eq('is_active', true)
    const tokenMap = new Map<string, string>()
    for (const c of channels ?? []) tokenMap.set(c.expert_id, c.channel_access_token)

    const monitorUrl = `${Deno.env.get('SITE_URL') || 'https://legendflow.tw'}/company/backtest-monitor`
    const message = buildFlex({
      total: allRuns.length, success, failed, trigger,
      topGainers, topLosers, failures, monitorUrl,
    })

    let pushed = 0
    let failedPush = 0
    for (const b of bindings) {
      const token = tokenMap.get((b as any).expert_id)
      if (!token) continue
      try {
        const res = await fetch(LINE_MULTICAST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to: (b as any).line_user_id, messages: [message] }),
        })
        if (res.ok) pushed++; else { failedPush++; console.error('LINE push failed', await res.text()) }
      } catch (e) { failedPush++; console.error('LINE push error', e) }
    }

    return new Response(JSON.stringify({
      ok: true, total: allRuns.length, success, failed,
      pushed, failed_push: failedPush, gainers: topGainers.length, losers: topLosers.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('notify-backtest-result error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
