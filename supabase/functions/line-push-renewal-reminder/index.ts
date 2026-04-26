import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

function buildRenewalFlexMessage(expertName: string, planName: string, daysLeft: number, expiresAt: string, amount: number) {
  const expiryDate = new Date(expiresAt).toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return {
    type: 'flex',
    altText: `⏰ 訂閱即將到期：${expertName}・${planName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF3CD',
        paddingAll: 'lg',
        contents: [
          {
            type: 'text',
            text: '⏰ 訂閱即將到期',
            weight: 'bold',
            size: 'lg',
            color: '#856404',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: expertName,
            weight: 'bold',
            size: 'xl',
            color: '#333333',
          },
          {
            type: 'text',
            text: planName,
            size: 'sm',
            color: '#666666',
            margin: 'sm',
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'lg',
            contents: [
              {
                type: 'text',
                text: '到期日',
                size: 'sm',
                color: '#999999',
                flex: 1,
              },
              {
                type: 'text',
                text: expiryDate,
                size: 'sm',
                color: '#333333',
                align: 'end',
                flex: 2,
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              {
                type: 'text',
                text: '剩餘天數',
                size: 'sm',
                color: '#999999',
                flex: 1,
              },
              {
                type: 'text',
                text: `${daysLeft} 天`,
                size: 'sm',
                color: '#DC3545',
                weight: 'bold',
                align: 'end',
                flex: 2,
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              {
                type: 'text',
                text: '續訂金額',
                size: 'sm',
                color: '#999999',
                flex: 1,
              },
              {
                type: 'text',
                text: `NT$${amount.toLocaleString()}`,
                size: 'sm',
                color: '#333333',
                weight: 'bold',
                align: 'end',
                flex: 2,
              },
            ],
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: `📌 系統將於到期日自動續訂扣款 NT$${amount.toLocaleString()}。`,
            size: 'sm',
            color: '#333333',
            margin: 'lg',
            wrap: true,
            weight: 'bold',
          },
          {
            type: 'text',
            text: '若您希望取消訂閱，請於到期日前至網頁版「帳號頁面」進行取消。',
            size: 'xs',
            color: '#999999',
            margin: 'sm',
            wrap: true,
          },
        ],
      },
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

    // Find subscriptions expiring in exactly 7 days (within a 24-hour window)
    const now = new Date()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const eightDaysFromNow = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)

    const { data: expiringSubs, error: subErr } = await supabaseAdmin
      .from('member_subscriptions')
      .select('id, user_id, plan_id, expires_at, expert_plans!inner(id, expert_id, name, price_monthly, experts!inner(id, name))')
      .eq('status', 'active')
      .gte('expires_at', sevenDaysFromNow.toISOString())
      .lt('expires_at', eightDaysFromNow.toISOString())

    if (subErr) {
      console.error('Query error:', subErr.message)
      return new Response(JSON.stringify({ error: subErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`Found ${expiringSubs?.length || 0} subscriptions expiring in ~7 days`)

    if (!expiringSubs || expiringSubs.length === 0) {
      return new Response(JSON.stringify({ reminded: 0, details: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Group by expert for batch sending
    const byExpert = new Map<string, {
      expertId: string
      expertName: string
      targets: { lineUserId: string; planName: string; expiresAt: string; daysLeft: number; amount: number }[]
    }>()

    for (const sub of expiringSubs) {
      const plan = sub.expert_plans as any
      const expert = plan.experts
      const expertId = expert.id as string
      const daysLeft = Math.ceil((new Date(sub.expires_at!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      const amount = plan.price_monthly || 0

      // Get LINE binding for this user+expert
      const { data: binding } = await supabaseAdmin
        .from('member_line_bindings')
        .select('line_user_id')
        .eq('user_id', sub.user_id)
        .eq('expert_id', expertId)
        .eq('is_active', true)
        .maybeSingle()

      if (!binding) continue

      if (!byExpert.has(expertId)) {
        byExpert.set(expertId, {
          expertId,
          expertName: expert.name,
          targets: [],
        })
      }

      byExpert.get(expertId)!.targets.push({
        lineUserId: binding.line_user_id,
        planName: plan.name,
        expiresAt: sub.expires_at!,
        daysLeft,
        amount,
      })
    }

    const results: any[] = []

    for (const [expertId, group] of byExpert) {
      // Get LINE channel
      const { data: channel } = await supabaseAdmin
        .from('expert_line_channels')
        .select('channel_access_token, is_active')
        .eq('expert_id', expertId)
        .single()

      if (!channel?.is_active || !channel?.channel_access_token) {
        console.log(`No active LINE channel for expert ${expertId}`)
        results.push({ expert_id: expertId, status: 'skipped', reason: 'no_channel' })
        continue
      }

      // Send individual messages (each user may have different plan/expiry)
      let pushed = 0
      for (const target of group.targets) {
        const message = buildRenewalFlexMessage(
          group.expertName,
          target.planName,
          target.daysLeft,
          target.expiresAt,
          target.amount,
        )

        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${channel.channel_access_token}`,
          },
          body: JSON.stringify({
            to: target.lineUserId,
            messages: [message],
          }),
        })

        if (res.ok) {
          pushed++
        } else {
          const errBody = await res.text()
          console.error(`LINE push failed for ${target.lineUserId}:`, res.status, errBody)
        }
      }

      console.log(`Expert ${group.expertName}: reminded ${pushed}/${group.targets.length} users`)
      results.push({ expert_id: expertId, expert_name: group.expertName, status: 'pushed', count: pushed })
    }

    const totalReminded = results.filter(r => r.status === 'pushed').reduce((sum, r) => sum + r.count, 0)
    console.log(`Total reminded: ${totalReminded}`)

    return new Response(JSON.stringify({ reminded: totalReminded, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('line-push-renewal-reminder error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})