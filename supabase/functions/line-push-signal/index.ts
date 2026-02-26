import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

function buildFlexMessage(signal: any) {
  const isBullish = ['buy', 'add'].includes(signal.action)
  const actionLabel: Record<string, string> = {
    buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '出場',
  }
  const color = isBullish ? '#00B900' : '#DC3545'
  const label = actionLabel[signal.action] || signal.action

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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = claimsData.claims.sub as string

    const { signal_id, expert_id } = await req.json()
    if (!signal_id || !expert_id) {
      return new Response(JSON.stringify({ error: 'Missing signal_id or expert_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller is analyst of this expert OR company_admin
    const { data: expertRow } = await supabaseAdmin
      .from('experts').select('id, user_id').eq('id', expert_id).single()

    if (!expertRow) {
      return new Response(JSON.stringify({ error: 'Expert not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: userId, _role: 'company_admin',
    })

    if (expertRow.user_id !== userId && !isAdmin) {
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
      return new Response(JSON.stringify({ error: 'Signal not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get active LINE bindings for this expert
    // Then filter to users who have active subscriptions for this expert
    const { data: bindings } = await supabaseAdmin
      .from('member_line_bindings')
      .select('line_user_id, user_id')
      .eq('expert_id', expert_id)
      .eq('is_active', true)

    if (!bindings || bindings.length === 0) {
      return new Response(JSON.stringify({ pushed: false, reason: 'no_bindings', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Filter to only users with active subscriptions to this expert
    const targets: string[] = []
    for (const b of bindings) {
      const { data: subs } = await supabaseAdmin
        .from('member_subscriptions')
        .select('id')
        .eq('user_id', b.user_id)
        .eq('status', 'active')
        .limit(1)

      if (subs && subs.length > 0) {
        targets.push(b.line_user_id)
      }
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ pushed: false, reason: 'no_active_subscribers', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const message = buildFlexMessage(signal)
    let totalPushed = 0

    // Send in batches of 500
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
        console.error(`LINE multicast failed for batch ${i}:`, errBody)
      }
    }

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
