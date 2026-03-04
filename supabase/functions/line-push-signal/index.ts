import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

function buildFlexMessage(signal: any, type: 'publish' | 'takedown' = 'publish') {
  const actionLabel: Record<string, string> = {
    buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
  }
  const label = actionLabel[signal.action] || signal.action

  if (type === 'takedown') {
    const bodyContents: any[] = [
      {
        type: 'text',
        text: '⚠️ 訊號已撤回',
        weight: 'bold',
        size: 'lg',
        color: '#DC3545',
      },
      {
        type: 'text',
        text: `${label} ${signal.instrument}`,
        size: 'md',
        color: '#444444',
        margin: 'md',
        weight: 'bold',
      },
    ]

    if (signal.taken_down_reason) {
      bodyContents.push({
        type: 'text',
        text: `撤回原因：${signal.taken_down_reason}`,
        size: 'sm',
        color: '#666666',
        margin: 'md',
        wrap: true,
      })
    }

    bodyContents.push({
      type: 'text',
      text: '請留意此訊號已不再有效，如有疑問請聯繫客服。',
      size: 'xs',
      color: '#999999',
      margin: 'lg',
      wrap: true,
    })

    return {
      type: 'flex',
      altText: `⚠️ 訊號已撤回：${label} ${signal.instrument}`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: bodyContents,
        },
      },
    }
  }

  // Default: publish message
  const isBullish = ['buy', 'add'].includes(signal.action)
  const color = isBullish ? '#00B900' : '#DC3545'

  // Build copy text for one-click copy
  const copyLines: string[] = [
    `${label} ${signal.instrument}`,
  ]
  if (signal.price_hint) copyLines.push(`參考價位：${signal.price_hint}`)
  if (signal.reason_summary) copyLines.push(`摘要：${signal.reason_summary}`)
  if (signal.reason_detail) copyLines.push(`分析：${signal.reason_detail}`)
  if (signal.risk_notes) copyLines.push(`風險：${signal.risk_notes}`)
  const copyText = copyLines.join('\n')

  const bodyContents: any[] = [
    {
      type: 'text',
      text: `${label} ${signal.instrument}`,
      weight: 'bold',
      size: 'xl',
      color,
    },
  ]

  if (signal.price_hint) {
    bodyContents.push({
      type: 'text',
      text: `參考價位：${signal.price_hint}`,
      size: 'sm',
      color: '#666666',
      margin: 'md',
    })
  }

  if (signal.reason_summary) {
    bodyContents.push({
      type: 'text',
      text: signal.reason_summary,
      size: 'sm',
      color: '#444444',
      margin: 'md',
      wrap: true,
    })
  }

  if (signal.reason_detail) {
    bodyContents.push({
      type: 'text',
      text: signal.reason_detail,
      size: 'sm',
      color: '#444444',
      margin: 'md',
      wrap: true,
    })
  }

  if (signal.risk_notes) {
    bodyContents.push({
      type: 'text',
      text: `⚠️ ${signal.risk_notes}`,
      size: 'xs',
      color: '#999999',
      margin: 'md',
      wrap: true,
    })
  }

  // Footer with copy button
  const footer = {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'button',
        action: {
          type: 'clipboard',
          label: '📋 一鍵複製',
          clipboardText: copyText,
        },
        style: 'secondary',
        height: 'sm',
        color: '#F0F0F0',
      },
    ],
    spacing: 'sm',
    paddingAll: 'lg',
  }

  return {
    type: 'flex',
    altText: `${label} ${signal.instrument}${signal.price_hint ? ` @ ${signal.price_hint}` : ''}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
      },
      footer,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('No auth header')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token)
    if (claimsError || !claimsData?.claims) {
      console.error('Auth getClaims failed:', claimsError?.message)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = claimsData.claims.sub as string
    console.log('Caller:', userId)

    const { signal_id, expert_id, type } = await req.json()
    const pushType = type === 'takedown' ? 'takedown' : 'publish'
    console.log('Push request:', { signal_id, expert_id, pushType })

    if (!signal_id || !expert_id) {
      console.error('Missing params')
      return new Response(JSON.stringify({ error: 'Missing signal_id or expert_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller is analyst of this expert OR company_admin
    const { data: expertRow } = await supabaseAdmin
      .from('experts').select('id, user_id').eq('id', expert_id).single()

    if (!expertRow) {
      console.error('Expert not found:', expert_id)
      return new Response(JSON.stringify({ error: 'Expert not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: userId, _role: 'company_admin',
    })

    if (expertRow.user_id !== userId && !isAdmin) {
      console.error('Forbidden: caller is not expert owner or admin')
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get LINE channel config
    const { data: channel } = await supabaseAdmin
      .from('expert_line_channels')
      .select('channel_access_token, is_active')
      .eq('expert_id', expert_id)
      .single()

    if (!channel || !channel.is_active || !channel.channel_access_token) {
      console.log('No active LINE channel for expert')
      return new Response(JSON.stringify({ pushed: false, reason: 'no_channel' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get signal data
    const { data: signal } = await supabaseAdmin
      .from('expert_signals')
      .select('*')
      .eq('id', signal_id)
      .single()

    if (!signal) {
      console.error('Signal not found:', signal_id)
      return new Response(JSON.stringify({ error: 'Signal not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get active LINE bindings for this expert
    const { data: bindings } = await supabaseAdmin
      .from('member_line_bindings')
      .select('line_user_id, user_id')
      .eq('expert_id', expert_id)
      .eq('is_active', true)

    console.log('Bindings found:', bindings?.length || 0)

    if (!bindings || bindings.length === 0) {
      return new Response(JSON.stringify({ pushed: false, reason: 'no_bindings', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Filter to only users with active subscriptions to THIS expert
    const { data: expertPlans } = await supabaseAdmin
      .from('expert_plans')
      .select('id')
      .eq('expert_id', expert_id)

    const expertPlanIds = (expertPlans || []).map(p => p.id)
    console.log('Expert plan IDs:', expertPlanIds)

    const targets: string[] = []
    if (expertPlanIds.length > 0) {
      for (const b of bindings) {
        const { data: subs } = await supabaseAdmin
          .from('member_subscriptions')
          .select('id')
          .eq('user_id', b.user_id)
          .eq('status', 'active')
          .in('plan_id', expertPlanIds)
          .limit(1)

        if (subs && subs.length > 0) {
          targets.push(b.line_user_id)
        }
      }
    }

    console.log('Targets with active subs:', targets.length)

    if (targets.length === 0) {
      return new Response(JSON.stringify({ pushed: false, reason: 'no_active_subscribers', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const message = buildFlexMessage(signal, pushType)
    let totalPushed = 0

    // Send in batches of 500
    for (let i = 0; i < targets.length; i += 500) {
      const batch = targets.slice(i, i + 500)
      console.log(`Sending batch ${i} to ${batch.length} users`)
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
        console.log(`Batch ${i} sent OK`)
      } else {
        const errBody = await res.text()
        console.error(`LINE multicast failed for batch ${i}:`, res.status, errBody)
      }
    }

    console.log('Total pushed:', totalPushed)
    return new Response(JSON.stringify({ pushed: true, count: totalPushed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('line-push-signal error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
