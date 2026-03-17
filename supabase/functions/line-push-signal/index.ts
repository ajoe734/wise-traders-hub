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
        text: '⚠️ 訊號已收回',
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
        text: `收回原因：${signal.taken_down_reason}`,
        size: 'sm',
        color: '#666666',
        margin: 'md',
        wrap: true,
      })
    }

    bodyContents.push({
      type: 'text',
      text: '此訊號已被分析師收回，不再有效。',
      size: 'xs',
      color: '#999999',
      margin: 'lg',
      wrap: true,
    })

    return {
      type: 'flex',
      altText: `⚠️ 訊號已收回：${label} ${signal.instrument}`,
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
  const qtyLabel = signal.quantity ? `(${signal.quantity}${signal.quantity_unit || '張'})` : ''
  const copyLines: string[] = [
    `【${label} ${signal.instrument}】`,
  ]
  if (signal.price_hint) copyLines.push(`參考價位：${signal.price_hint}${qtyLabel}`)
  if (signal.reason_summary) copyLines.push(`\n📌 摘要：\n${signal.reason_summary}`)
  if (signal.reason_detail) copyLines.push(`\n📊 詳細分析：\n${signal.reason_detail}`)
  if (signal.risk_notes) copyLines.push(`\n⚠️ 風險提示：\n${signal.risk_notes}`)
  if (signal.learning_points) copyLines.push(`\n🎯 教學重點：\n${signal.learning_points}`)
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
    const qtyText = signal.quantity ? `(${signal.quantity}${signal.quantity_unit || '張'})` : ''
    bodyContents.push({
      type: 'text',
      text: `參考價位：${signal.price_hint}${qtyText}`,
      size: 'sm',
      color: '#666666',
      margin: 'md',
    })
  }

  if (signal.reason_summary) {
    bodyContents.push(
      {
        type: 'text',
        text: '📌 摘要',
        size: 'sm',
        color: '#333333',
        margin: 'lg',
        weight: 'bold',
      },
      {
        type: 'text',
        text: signal.reason_summary,
        size: 'sm',
        color: '#444444',
        margin: 'sm',
        wrap: true,
      },
    )
  }

  if (signal.reason_detail) {
    bodyContents.push(
      {
        type: 'text',
        text: '📊 詳細分析',
        size: 'sm',
        color: '#333333',
        margin: 'lg',
        weight: 'bold',
      },
      {
        type: 'text',
        text: signal.reason_detail,
        size: 'sm',
        color: '#444444',
        margin: 'sm',
        wrap: true,
      },
    )
  }

  if (signal.risk_notes) {
    bodyContents.push(
      {
        type: 'text',
        text: '⚠️ 風險提示',
        size: 'sm',
        color: '#DC3545',
        margin: 'lg',
        weight: 'bold',
      },
      {
        type: 'text',
        text: signal.risk_notes,
        size: 'xs',
        color: '#999999',
        margin: 'sm',
        wrap: true,
      },
    )
  }

  if (signal.learning_points) {
    bodyContents.push(
      {
        type: 'text',
        text: '🎯 教學重點',
        size: 'sm',
        color: '#333333',
        margin: 'lg',
        weight: 'bold',
      },
      {
        type: 'text',
        text: signal.learning_points,
        size: 'sm',
        color: '#444444',
        margin: 'sm',
        wrap: true,
      },
    )
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

async function getTargets(supabaseAdmin: any, expert_id: string) {
  const { data: bindings } = await supabaseAdmin
    .from('member_line_bindings')
    .select('line_user_id, user_id')
    .eq('expert_id', expert_id)
    .eq('is_active', true)

  if (!bindings || bindings.length === 0) {
    return { targets: [], reason: 'no_bindings' }
  }

  const bindingUserIds = bindings.map((b: any) => b.user_id)
  const { data: activeSubs } = await supabaseAdmin
    .from('member_subscriptions')
    .select('user_id, plan_id')
    .in('user_id', bindingUserIds)
    .eq('status', 'active')

  const { data: expertPlans } = await supabaseAdmin
    .from('expert_plans')
    .select('id')
    .eq('expert_id', expert_id)

  const expertPlanIds = new Set((expertPlans || []).map((p: any) => p.id))
  const subscribedUserIds = new Set(
    (activeSubs || []).filter((s: any) => expertPlanIds.has(s.plan_id)).map((s: any) => s.user_id)
  )

  const targets = bindings
    .filter((b: any) => subscribedUserIds.has(b.user_id))
    .map((b: any) => b.line_user_id)

  if (targets.length === 0) {
    return { targets: [], reason: 'no_active_subscribers' }
  }

  return { targets, reason: null }
}

async function sendToLine(channelToken: string, targets: string[], message: any) {
  let totalPushed = 0
  for (let i = 0; i < targets.length; i += 500) {
    const batch = targets.slice(i, i + 500)
    console.log(`Sending batch ${i} to ${batch.length} users`)
    const res = await fetch(LINE_MULTICAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`,
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
  return totalPushed
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

    const body = await req.json()
    const { signal_id, expert_id, type, mode, signal_data } = body
    const pushType = type === 'takedown' ? 'takedown' : 'publish'
    console.log('Push request:', { signal_id, expert_id, pushType, mode })

    if (!expert_id) {
      console.error('Missing expert_id')
      return new Response(JSON.stringify({ error: 'Missing expert_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller is analyst of this expert OR company_admin
    const { data: expertRow } = await supabaseAdmin
      .from('experts').select('id, user_id, role').eq('id', expert_id).single()

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

    // MODE: preview — push inline signal_data to LINE without DB
    if (mode === 'preview' && signal_data) {
      console.log('Preview mode: pushing inline signal data to LINE, type:', pushType)
      const message = buildFlexMessage(signal_data, pushType)

      const { targets, reason } = await getTargets(supabaseAdmin, expert_id)
      if (targets.length === 0) {
        return new Response(JSON.stringify({ pushed: false, reason: reason || 'no_bindings', count: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const totalPushed = await sendToLine(channel.channel_access_token, targets, message)

      console.log('Preview push total:', totalPushed)
      return new Response(JSON.stringify({ pushed: true, count: totalPushed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Standard mode: fetch signal from DB
    if (!signal_id) {
      console.error('Missing signal_id')
      return new Response(JSON.stringify({ error: 'Missing signal_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    const message = buildFlexMessage(signal, pushType)

    const { targets, reason } = await getTargets(supabaseAdmin, expert_id)
    console.log('Targets:', targets.length)

    if (targets.length === 0) {
      return new Response(JSON.stringify({ pushed: false, reason: reason || 'no_bindings', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const totalPushed = await sendToLine(channel.channel_access_token, targets, message)

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
