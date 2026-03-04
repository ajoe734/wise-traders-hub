import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

function buildFlexMessage(signal: any) {
  const actionLabel: Record<string, string> = {
    buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
  }
  const label = actionLabel[signal.action] || signal.action
  const isBullish = ['buy', 'add'].includes(signal.action)
  const color = isBullish ? '#00B900' : '#DC3545'

  const copyLines: string[] = [`【${label} ${signal.instrument}】`]
  if (signal.price_hint) copyLines.push(`參考價位：${signal.price_hint}`)
  if (signal.reason_summary) copyLines.push(`\n📌 摘要：\n${signal.reason_summary}`)
  if (signal.reason_detail) copyLines.push(`\n📊 詳細分析：\n${signal.reason_detail}`)
  if (signal.risk_notes) copyLines.push(`\n⚠️ 風險提示：\n${signal.risk_notes}`)
  const copyText = copyLines.join('\n')

  const bodyContents: any[] = [
    {
      type: 'text',
      text: '📚 實戰週記',
      size: 'xs',
      color: '#8B6914',
      weight: 'bold',
    },
    {
      type: 'text',
      text: `${label} ${signal.instrument}`,
      weight: 'bold',
      size: 'xl',
      color,
      margin: 'sm',
    },
  ]

  if (signal.price_hint) {
    bodyContents.push({
      type: 'text', text: `參考價位：${signal.price_hint}`,
      size: 'sm', color: '#666666', margin: 'md',
    })
  }

  if (signal.reason_summary) {
    bodyContents.push(
      { type: 'text', text: '📌 摘要', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.reason_summary, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  if (signal.reason_detail) {
    bodyContents.push(
      { type: 'text', text: '📊 詳細分析', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.reason_detail, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  if (signal.risk_notes) {
    bodyContents.push(
      { type: 'text', text: '⚠️ 風險提示', size: 'sm', color: '#DC3545', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.risk_notes, size: 'xs', color: '#999999', margin: 'sm', wrap: true },
    )
  }

  const footer = {
    type: 'box', layout: 'vertical',
    contents: [{
      type: 'button',
      action: { type: 'clipboard', label: '📋 一鍵複製', clipboardText: copyText },
      style: 'secondary', height: 'sm', color: '#F0F0F0',
    }],
    spacing: 'sm', paddingAll: 'lg',
  }

  return {
    type: 'flex',
    altText: `📚 實戰週記：${label} ${signal.instrument}`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Find mentor signals that are 7+ days old and not yet pushed
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: signals, error: sigErr } = await supabaseAdmin
      .from('expert_signals')
      .select('*, experts!inner(id, role, user_id)')
      .eq('status', 'published')
      .is('line_pushed_at', null)
      .lte('published_at', sevenDaysAgo)

    if (sigErr) {
      console.error('Query error:', sigErr.message)
      return new Response(JSON.stringify({ error: sigErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Filter to mentor signals only
    const mentorSignals = (signals || []).filter((s: any) => s.experts?.role === 'mentor')
    console.log(`Found ${mentorSignals.length} mentor signals ready for delayed push`)

    if (mentorSignals.length === 0) {
      return new Response(JSON.stringify({ pushed: 0, details: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []

    for (const signal of mentorSignals) {
      const expertId = signal.expert_id
      console.log(`Processing signal ${signal.id} for expert ${expertId}`)

      // Get LINE channel
      const { data: channel } = await supabaseAdmin
        .from('expert_line_channels')
        .select('channel_access_token, is_active')
        .eq('expert_id', expertId)
        .single()

      if (!channel?.is_active || !channel?.channel_access_token) {
        console.log(`No active LINE channel for expert ${expertId}`)
        // Still mark as pushed to avoid retrying forever
        await supabaseAdmin.from('expert_signals').update({ line_pushed_at: new Date().toISOString() }).eq('id', signal.id)
        results.push({ signal_id: signal.id, status: 'skipped', reason: 'no_channel' })
        continue
      }

      // Get active LINE bindings
      const { data: bindings } = await supabaseAdmin
        .from('member_line_bindings')
        .select('line_user_id, user_id')
        .eq('expert_id', expertId)
        .eq('is_active', true)

      if (!bindings || bindings.length === 0) {
        await supabaseAdmin.from('expert_signals').update({ line_pushed_at: new Date().toISOString() }).eq('id', signal.id)
        results.push({ signal_id: signal.id, status: 'skipped', reason: 'no_bindings' })
        continue
      }

      // Filter to subscribers with active subscription AND started_at <= published_at
      const bindingUserIds = bindings.map(b => b.user_id)
      const { data: activeSubs } = await supabaseAdmin
        .from('member_subscriptions')
        .select('user_id, plan_id, started_at')
        .in('user_id', bindingUserIds)
        .eq('status', 'active')

      const { data: expertPlans } = await supabaseAdmin
        .from('expert_plans')
        .select('id')
        .eq('expert_id', expertId)

      const expertPlanIds = new Set((expertPlans || []).map(p => p.id))

      // Only include subscribers whose subscription started before signal was published
      const subscribedUserIds = new Set(
        (activeSubs || [])
          .filter(s =>
            expertPlanIds.has(s.plan_id) &&
            (!signal.published_at || !s.started_at || new Date(s.started_at) <= new Date(signal.published_at))
          )
          .map(s => s.user_id)
      )

      const targets = bindings
        .filter(b => subscribedUserIds.has(b.user_id))
        .map(b => b.line_user_id)

      console.log(`Signal ${signal.id}: ${targets.length} eligible targets`)

      if (targets.length === 0) {
        await supabaseAdmin.from('expert_signals').update({ line_pushed_at: new Date().toISOString() }).eq('id', signal.id)
        results.push({ signal_id: signal.id, status: 'skipped', reason: 'no_eligible_subscribers' })
        continue
      }

      const message = buildFlexMessage(signal)
      let totalPushed = 0

      for (let i = 0; i < targets.length; i += 500) {
        const batch = targets.slice(i, i + 500)
        const res = await fetch(LINE_MULTICAST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${channel.channel_access_token}`,
          },
          body: JSON.stringify({ to: batch, messages: [message] }),
        })

        if (res.ok) {
          totalPushed += batch.length
        } else {
          const errBody = await res.text()
          console.error(`LINE multicast failed for signal ${signal.id}:`, res.status, errBody)
        }
      }

      // Mark as pushed
      await supabaseAdmin.from('expert_signals').update({ line_pushed_at: new Date().toISOString() }).eq('id', signal.id)
      results.push({ signal_id: signal.id, status: 'pushed', count: totalPushed })
      console.log(`Signal ${signal.id}: pushed to ${totalPushed} users`)
    }

    const totalPushed = results.filter(r => r.status === 'pushed').reduce((sum, r) => sum + r.count, 0)
    console.log(`Total pushed: ${totalPushed} across ${results.length} signals`)

    return new Response(JSON.stringify({ pushed: totalPushed, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('line-push-delayed error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
