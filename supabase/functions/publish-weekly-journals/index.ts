import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Find all pending mentor signals
    const { data: pendingSignals, error: fetchErr } = await supabaseAdmin
      .from('expert_signals')
      .select('id, expert_id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at')
      .eq('status', 'pending')

    if (fetchErr) {
      console.error('Error fetching pending signals:', fetchErr)
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!pendingSignals || pendingSignals.length === 0) {
      console.log('No pending signals to publish')
      return new Response(JSON.stringify({ published: 0, pushed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Found ${pendingSignals.length} pending signals`)

    // Update all pending signals to published
    const signalIds = pendingSignals.map(s => s.id)
    const { error: updateErr } = await supabaseAdmin
      .from('expert_signals')
      .update({ status: 'published' })
      .in('id', signalIds)

    if (updateErr) {
      console.error('Error updating signals to published:', updateErr)
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Updated ${signalIds.length} signals to published`)

    // Group by expert_id for LINE push
    const byExpert = new Map<string, typeof pendingSignals>()
    for (const signal of pendingSignals) {
      const list = byExpert.get(signal.expert_id) || []
      list.push(signal)
      byExpert.set(signal.expert_id, list)
    }

    let totalPushed = 0

    for (const [expertId, signals] of byExpert) {
      // Get LINE channel
      const { data: channel } = await supabaseAdmin
        .from('expert_line_channels')
        .select('channel_access_token, is_active')
        .eq('expert_id', expertId)
        .single()

      if (!channel?.is_active || !channel?.channel_access_token) {
        console.log(`No active LINE channel for expert ${expertId}`)
        continue
      }

      // Get expert name
      const { data: expert } = await supabaseAdmin
        .from('experts')
        .select('name')
        .eq('id', expertId)
        .single()

      // Get active subscriber LINE targets
      const { data: bindings } = await supabaseAdmin
        .from('member_line_bindings')
        .select('line_user_id, user_id')
        .eq('expert_id', expertId)
        .eq('is_active', true)

      if (!bindings || bindings.length === 0) {
        console.log(`No LINE bindings for expert ${expertId}`)
        continue
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
        .eq('expert_id', expertId)

      const expertPlanIds = new Set((expertPlans || []).map((p: any) => p.id))
      const subscribedUserIds = new Set(
        (activeSubs || []).filter((s: any) => expertPlanIds.has(s.plan_id)).map((s: any) => s.user_id)
      )

      const targets = bindings
        .filter((b: any) => subscribedUserIds.has(b.user_id))
        .map((b: any) => b.line_user_id)

      if (targets.length === 0) {
        console.log(`No active subscribers for expert ${expertId}`)
        continue
      }

      // Build a bundled Flex Message for all signals
      const expertName = expert?.name || '導師'
      const actionLabel: Record<string, string> = {
        buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
      }

      const instrumentList = signals.map(s => {
        const label = actionLabel[s.action] || s.action
        return `${label} ${s.instrument}`
      }).join('\n')

      const bodyContents: any[] = [
        {
          type: 'text',
          text: `📖 ${expertName} 本週週記`,
          weight: 'bold',
          size: 'xl',
          color: '#3B82F6',
        },
        {
          type: 'text',
          text: `本週共 ${signals.length} 筆操作紀錄`,
          size: 'sm',
          color: '#666666',
          margin: 'md',
        },
        {
          type: 'separator',
          margin: 'lg',
        },
        {
          type: 'text',
          text: instrumentList,
          size: 'sm',
          color: '#444444',
          margin: 'lg',
          wrap: true,
        },
      ]

      // Add first signal's reason_summary as weekly highlight
      const firstSummary = signals[0]?.reason_summary
      if (firstSummary) {
        bodyContents.push(
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '📌 本週重點',
            size: 'sm',
            color: '#333333',
            margin: 'lg',
            weight: 'bold',
          },
          {
            type: 'text',
            text: firstSummary,
            size: 'sm',
            color: '#444444',
            margin: 'sm',
            wrap: true,
          },
        )
      }

      // Collect learning points
      const allLearningPoints = signals
        .map(s => s.learning_points)
        .filter(Boolean)
        .join('\n')

      if (allLearningPoints) {
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
            text: allLearningPoints.slice(0, 300),
            size: 'sm',
            color: '#444444',
            margin: 'sm',
            wrap: true,
          },
        )
      }

      bodyContents.push({
        type: 'text',
        text: '前往 App 查看完整週記 →',
        size: 'xs',
        color: '#999999',
        margin: 'xl',
      })

      const message = {
        type: 'flex',
        altText: `📖 ${expertName} 本週週記已發布（${signals.length} 筆操作）`,
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: bodyContents,
          },
        },
      }

      // Send to LINE in batches of 500
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
          console.log(`Pushed to ${batch.length} users for expert ${expertId}`)
        } else {
          const errBody = await res.text()
          console.error(`LINE push failed for expert ${expertId}:`, res.status, errBody)
        }
      }
    }

    console.log(`Total published: ${signalIds.length}, Total pushed: ${totalPushed}`)
    return new Response(JSON.stringify({ published: signalIds.length, pushed: totalPushed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('publish-weekly-journals error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
