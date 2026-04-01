import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

// Build promo message for canceled subscribers
function buildPromoMessage(expertName: string, performance: any, signalCount: number) {
  const bodyContents: any[] = [
    {
      type: 'text',
      text: `📊 ${expertName} 最新績效`,
      weight: 'bold',
      size: 'lg',
      color: '#333333',
    },
    {
      type: 'text',
      text: `本週發布了 ${signalCount} 筆操作紀錄，以下是最新績效表現：`,
      size: 'sm',
      color: '#666666',
      margin: 'md',
      wrap: true,
    },
    { type: 'separator', margin: 'lg' },
  ]

  if (performance) {
    const winRate = performance.win_rate != null ? `${Number(performance.win_rate).toFixed(1)}%` : '-'
    const cumReturn = performance.cumulative_return != null ? `${Number(performance.cumulative_return).toFixed(1)}%` : '-'
    const return1y = performance.return_1y != null ? `${Number(performance.return_1y).toFixed(1)}%` : '-'
    const totalTrades = performance.total_trades ?? 0

    bodyContents.push(
      {
        type: 'box', layout: 'horizontal', margin: 'lg', contents: [
          { type: 'text', text: '📈 累計報酬', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: cumReturn, size: 'sm', color: '#00B900', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
      {
        type: 'box', layout: 'horizontal', margin: 'sm', contents: [
          { type: 'text', text: '📅 近一年報酬', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: return1y, size: 'sm', color: '#00B900', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
      {
        type: 'box', layout: 'horizontal', margin: 'sm', contents: [
          { type: 'text', text: '🎯 勝率', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: winRate, size: 'sm', color: '#333', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
      {
        type: 'box', layout: 'horizontal', margin: 'sm', contents: [
          { type: 'text', text: '📊 總交易數', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: `${totalTrades}`, size: 'sm', color: '#333', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
    )
  }

  bodyContents.push(
    { type: 'separator', margin: 'lg' },
    {
      type: 'text',
      text: '想跟上最新操作？立即重新訂閱！',
      size: 'sm',
      color: '#FF6B00',
      margin: 'lg',
      weight: 'bold',
      wrap: true,
    },
  )

  return {
    type: 'flex',
    altText: `📊 ${expertName} 本週發布 ${signalCount} 筆操作 — 立即重新訂閱！`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
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

    // Find all pending mentor signals
    const { data: pendingSignals, error: fetchErr } = await supabaseAdmin
      .from('expert_signals')
      .select('id, expert_id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, teaching_topic, overall_summary, published_at')
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

    // Sync trade_signals + user_performances for each published signal
    // This ensures the Python price fetcher picks up mentor positions
    for (const signal of pendingSignals) {
      const { data: expertRow } = await supabaseAdmin
        .from('experts')
        .select('user_id')
        .eq('id', signal.expert_id)
        .single()

      if (!expertRow?.user_id) continue

      const stockCode = signal.instrument.split(' ')[0]?.trim()
      const stockName = signal.instrument.split(' ').slice(1).join(' ')?.trim() || null
      const entryPrice = signal.price_hint || 0

      if (signal.action === 'exit') {
        await supabaseAdmin
          .from('trade_signals')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('user_id', expertRow.user_id)
          .eq('symbol', stockCode)
          .eq('status', 'open')

        await supabaseAdmin
          .from('user_performances')
          .delete()
          .eq('user_id', expertRow.user_id)
          .eq('symbol', stockCode)

      } else if (signal.action === 'sell' || signal.action === 'trim') {
        // Check if any open trade_records remain after trigger
        const { data: remaining } = await supabaseAdmin
          .from('trade_records')
          .select('id')
          .eq('expert_id', signal.expert_id)
          .ilike('instrument', `${stockCode}%`)
          .eq('status', 'open')
          .limit(1)

        if (!remaining || remaining.length === 0) {
          await supabaseAdmin
            .from('trade_signals')
            .update({ status: 'closed', closed_at: new Date().toISOString() })
            .eq('user_id', expertRow.user_id)
            .eq('symbol', stockCode)
            .eq('status', 'open')

          await supabaseAdmin
            .from('user_performances')
            .delete()
            .eq('user_id', expertRow.user_id)
            .eq('symbol', stockCode)
        }

      } else {
        // buy / add: ensure trade_signals entry exists
        const { data: existing } = await supabaseAdmin
          .from('trade_signals')
          .select('id')
          .eq('user_id', expertRow.user_id)
          .eq('symbol', stockCode)
          .eq('status', 'open')
          .limit(1)

        if (!existing || existing.length === 0) {
          const { data: tsData } = await supabaseAdmin
            .from('trade_signals')
            .insert({
              user_id: expertRow.user_id,
              symbol: stockCode,
              name: stockName,
              entry_price: entryPrice,
              status: 'open',
            })
            .select('id')
            .single()

          if (tsData) {
            await supabaseAdmin
              .from('user_performances')
              .insert({
                user_id: expertRow.user_id,
                signal_id: tsData.id,
                symbol: stockCode,
                name: stockName,
                entry_price: entryPrice,
                current_price: entryPrice,
                pnl: 0,
                pnl_percent: 0,
              })
          }
        }
      }
    }

    console.log('Trade signals synced for all published mentor signals')

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

      // Get active subscriber LINE targets — split subscribed vs canceled
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
        .select('user_id, plan_id, canceled_at')
        .in('user_id', bindingUserIds)
        .eq('status', 'active')

      const { data: expertPlans } = await supabaseAdmin
        .from('expert_plans')
        .select('id')
        .eq('expert_id', expertId)

      const expertPlanIds = new Set((expertPlans || []).map((p: any) => p.id))
      const relevantSubs = (activeSubs || []).filter((s: any) => expertPlanIds.has(s.plan_id))
      const subscribedUserIds = new Set(relevantSubs.filter((s: any) => !s.canceled_at).map((s: any) => s.user_id))
      const canceledUserIds = new Set(relevantSubs.filter((s: any) => s.canceled_at).map((s: any) => s.user_id))

      const subscribedTargets = bindings.filter((b: any) => subscribedUserIds.has(b.user_id)).map((b: any) => b.line_user_id)
      const canceledTargets = bindings.filter((b: any) => canceledUserIds.has(b.user_id)).map((b: any) => b.line_user_id)

      // Build normal content message for subscribed users
      const expertName = expert?.name || '導師'
      const actionLabel: Record<string, string> = {
        buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
      }

      // Use teaching_topic + overall_summary from first signal (they share the same weekly context)
      const firstSignal = signals[0]
      const teachingTopic = (firstSignal as any).teaching_topic || ''
      const overallSummary = (firstSignal as any).overall_summary || ''

      const copyLines: string[] = [`${expertName} 本週週記`, '']
      if (teachingTopic) copyLines.push(`📚 教學主題：${teachingTopic}`)
      if (overallSummary) copyLines.push(`📝 整體摘要：${overallSummary}`)
      copyLines.push(`本週共 ${signals.length} 筆操作紀錄`, '')

      const bodyContents: any[] = []

      if (teachingTopic) {
        bodyContents.push({
          type: 'text',
          text: `📚 ${teachingTopic}`,
          weight: 'bold',
          size: 'lg',
          color: '#333333',
        })
      }

      bodyContents.push({
        type: 'text',
        text: `本週共 ${signals.length} 筆 操作紀錄`,
        weight: teachingTopic ? 'regular' : 'bold',
        size: teachingTopic ? 'sm' : 'lg',
        color: '#333333',
        margin: teachingTopic ? 'md' : undefined,
      })

      if (overallSummary) {
        bodyContents.push({
          type: 'text',
          text: overallSummary,
          size: 'sm',
          color: '#666666',
          margin: 'md',
          wrap: true,
        })
      }

      bodyContents.push({ type: 'separator', margin: 'lg' })

      for (const s of signals) {
        const label = actionLabel[s.action] || s.action
        const isBullish = ['buy', 'add'].includes(s.action)
        const color = isBullish ? '#00B900' : '#DC3545'

        bodyContents.push({
          type: 'text', text: `${label} ${s.instrument}`, size: 'md', color, margin: 'lg', weight: 'bold',
        })

        if (s.reason_summary) {
          bodyContents.push({ type: 'text', text: `❓ 為什麼這樣操作？${s.reason_summary}`, size: 'sm', color: '#444444', margin: 'sm', wrap: true })
        }
        if (s.reason_detail) {
          bodyContents.push({ type: 'text', text: `◉ 部位控管想法：${s.reason_detail}`, size: 'xs', color: '#666666', margin: 'sm', wrap: true })
        }
        if (s.risk_notes) {
          bodyContents.push({ type: 'text', text: `⚠️ 風險提醒：${s.risk_notes}`, size: 'sm', color: '#444444', margin: 'sm', wrap: true })
        }
        if (s.learning_points) {
          bodyContents.push({ type: 'text', text: `🎯 教學重點：${s.learning_points}`, size: 'xs', color: '#333333', margin: 'sm', wrap: true })
        }

        bodyContents.push({ type: 'separator', margin: 'md' })
      }

      // Build copy text
      for (const s of signals) {
        const label = actionLabel[s.action] || s.action
        copyLines.push(`【${label} ${s.instrument}】`)
        if (s.reason_summary) copyLines.push(`❓ 為什麼這樣操作？${s.reason_summary}`)
        if (s.reason_detail) copyLines.push(`◉ 部位控管想法：${s.reason_detail}`)
        if (s.risk_notes) copyLines.push(`⚠️ 風險提醒：${s.risk_notes}`)
        if (s.learning_points) copyLines.push(`🎯 教學重點：${s.learning_points}`)
        copyLines.push('')
      }
      const copyText = copyLines.join('\n')

      const footer = {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'clipboard', label: '📋 一鍵複製', clipboardText: copyText },
            style: 'secondary',
            height: 'sm',
            color: '#F0F0F0',
          },
        ],
        spacing: 'sm',
        paddingAll: 'lg',
      }

      const altTextTopic = teachingTopic ? `${teachingTopic} — ` : ''
      const message = {
        type: 'flex',
        altText: `📖 ${expertName} 本週週記已發布${altTextTopic}（${signals.length} 筆操作）`,
        contents: {
          type: 'bubble',
          body: { type: 'box', layout: 'vertical', contents: bodyContents },
          footer,
        },
      }

      // Send normal content to subscribed users
      if (subscribedTargets.length > 0) {
        for (let i = 0; i < subscribedTargets.length; i += 500) {
          const batch = subscribedTargets.slice(i, i + 500)
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
            console.log(`Pushed to ${batch.length} subscribed users for expert ${expertId}`)
          } else {
            const errBody = await res.text()
            console.error(`LINE push failed for expert ${expertId}:`, res.status, errBody)
          }
        }
      }

      // Send promo message to canceled users
      if (canceledTargets.length > 0) {
        // Get performance data
        const { data: perfData } = await supabaseAdmin.rpc('calculate_expert_performance', { _expert_id: expertId })
        const promoMsg = buildPromoMessage(expertName, perfData, signals.length)

        for (let i = 0; i < canceledTargets.length; i += 500) {
          const batch = canceledTargets.slice(i, i + 500)
          const res = await fetch(LINE_MULTICAST_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${channel.channel_access_token}`,
            },
            body: JSON.stringify({ to: batch, messages: [promoMsg] }),
          })

          if (res.ok) {
            totalPushed += batch.length
            console.log(`Promo pushed to ${batch.length} canceled users for expert ${expertId}`)
          } else {
            const errBody = await res.text()
            console.error(`LINE promo push failed for expert ${expertId}:`, res.status, errBody)
          }
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
