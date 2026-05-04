import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

// 將 TipTap HTML 拍平成 LINE 純文字（保留段落/列表的換行）
function htmlToText(s: any): string {
  if (s == null) return ''
  const str = String(s)
  if (!/<[a-z][^>]*>/i.test(str)) return str
  return str
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<img[^>]*>/gi, '[圖片] ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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

  const runId = crypto.randomUUID().slice(0, 8)
  const t0 = Date.now()
  const log = (msg: string, extra?: unknown) =>
    extra !== undefined
      ? console.log(`[publish-weekly-journals][${runId}] ${msg}`, extra)
      : console.log(`[publish-weekly-journals][${runId}] ${msg}`)
  const logErr = (stage: string, err: unknown, extra?: Record<string, unknown>) => {
    const e = err as any
    console.error(`[publish-weekly-journals][${runId}][stage=${stage}] FAILED`, {
      name: e?.name,
      message: e?.message ?? String(err),
      code: e?.code,
      details: e?.details,
      hint: e?.hint,
      status: e?.status,
      stack: e?.stack,
      ...extra,
    })
  }

  let stage = 'init'
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
      console.error(`[publish-weekly-journals][${runId}] Missing env: ${missing.join(', ')}`)
      return new Response(JSON.stringify({ error: 'Missing required env', missing, runId }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    log('Function start')

    // (replaced by stage-tracked block below)

    stage = 'fetch_pending_signals'
    const { data: pendingSignals, error: fetchErr } = await supabaseAdmin
      .from('expert_signals')
      .select('id, expert_id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, teaching_topic, overall_summary, published_at, batch_id, executed_at')
      .eq('status', 'pending')

    if (fetchErr) {
      logErr(stage, fetchErr)
      return new Response(JSON.stringify({ error: fetchErr.message, stage, runId }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!pendingSignals || pendingSignals.length === 0) {
      log('No pending signals to publish')
      return new Response(JSON.stringify({ published: 0, pushed: 0, runId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    log(`Found ${pendingSignals.length} pending signals`)

    stage = 'mark_published'
    const signalIds = pendingSignals.map(s => s.id)
    const { error: updateErr } = await supabaseAdmin
      .from('expert_signals')
      .update({ status: 'published' })
      .in('id', signalIds)

    if (updateErr) {
      logErr(stage, updateErr, { signalIds })
      return new Response(JSON.stringify({ error: updateErr.message, stage, runId }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    log(`Updated ${signalIds.length} signals to published`)

    // Sync trade_signals + user_performances for each published signal
    stage = 'sync_trade_signals'
    let syncOk = 0, syncFail = 0
    for (const signal of pendingSignals) {
      try {
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
        syncOk++
      } catch (innerErr) {
        syncFail++
        logErr('sync_trade_signals_iteration', innerErr, { signalId: signal.id, instrument: signal.instrument, action: signal.action })
      }
    }

    log(`Trade signals synced (ok=${syncOk}, fail=${syncFail})`)

    // Group by expert_id for LINE push
    stage = 'group_by_expert'
    const byExpert = new Map<string, typeof pendingSignals>()
    for (const signal of pendingSignals) {
      const list = byExpert.get(signal.expert_id) || []
      list.push(signal)
      byExpert.set(signal.expert_id, list)
    }

    let totalPushed = 0
    let pushFail = 0

    stage = 'line_push'
    for (const [expertId, signals] of byExpert) {
     try {
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
        .select('user_id, plan_id, canceled_at, expires_at')
        .in('user_id', bindingUserIds)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())

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

      // batch grouping below

      // 依 batch_id 分組（同一篇週記 = 一個 bubble）；無 batch_id 的視為自身一組
      const byBatch = new Map<string, typeof signals>()
      for (const s of signals) {
        const k = (s as any).batch_id || `__solo_${s.id}`
        const arr = byBatch.get(k) || []
        arr.push(s)
        byBatch.set(k, arr)
      }

      const expertName = expert?.name || '導師'
      const actionLabel: Record<string, string> = {
        buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '平損',
      }

      const buildBubble = (group: typeof signals) => {
        const first = group[0] as any
        const teachingTopic = htmlToText(first.teaching_topic || '')
        const overallSummary = htmlToText(first.overall_summary || '')
        const learningPoints = htmlToText(first.learning_points || '')

        const bodyContents: any[] = []
        if (teachingTopic) {
          bodyContents.push({ type: 'text', text: `📚 ${teachingTopic}`, weight: 'bold', size: 'lg', color: '#333333', wrap: true })
        }
        bodyContents.push({
          type: 'text',
          text: `本週共 ${group.length} 筆 操作紀錄`,
          weight: teachingTopic ? 'regular' : 'bold',
          size: teachingTopic ? 'sm' : 'lg',
          color: '#333333',
          margin: teachingTopic ? 'md' : undefined,
        })
        if (overallSummary) {
          bodyContents.push({ type: 'text', text: overallSummary, size: 'sm', color: '#666666', margin: 'md', wrap: true })
        }
        bodyContents.push({ type: 'separator', margin: 'lg' })

        for (const s of group) {
          const label = actionLabel[s.action] || s.action
          const isBullish = ['buy', 'add'].includes(s.action)
          const color = isBullish ? '#DC3545' : '#00B900' // 台股慣例：紅漲綠跌
          bodyContents.push({ type: 'text', text: `${label} ${s.instrument}`, size: 'md', color, margin: 'lg', weight: 'bold' })
          const rs = htmlToText((s as any).reason_summary)
          const rd = htmlToText((s as any).reason_detail)
          const rn = htmlToText((s as any).risk_notes)
          if (rs) bodyContents.push({ type: 'text', text: `❓ 為什麼這樣操作？${rs}`, size: 'sm', color: '#444444', margin: 'sm', wrap: true })
          if (rd) bodyContents.push({ type: 'text', text: `◉ 部位控管想法：${rd}`, size: 'xs', color: '#666666', margin: 'sm', wrap: true })
          if (rn) bodyContents.push({ type: 'text', text: `⚠️ 風險提醒：${rn}`, size: 'sm', color: '#444444', margin: 'sm', wrap: true })
          bodyContents.push({ type: 'separator', margin: 'md' })
        }
        if (learningPoints) {
          bodyContents.push({ type: 'text', text: `🎯 教學重點：${learningPoints}`, size: 'sm', color: '#333333', margin: 'md', wrap: true })
        }

        // copy text
        const copyLines: string[] = [`${expertName} 本週週記`, '']
        if (teachingTopic) copyLines.push(`📚 教學主題：${teachingTopic}`)
        if (overallSummary) copyLines.push(`📝 整體摘要：${overallSummary}`)
        copyLines.push(`本週共 ${group.length} 筆操作紀錄`, '')
        for (const s of group) {
          const label = actionLabel[s.action] || s.action
          copyLines.push(`【${label} ${s.instrument}】`)
          const rs = htmlToText((s as any).reason_summary)
          const rd = htmlToText((s as any).reason_detail)
          const rn = htmlToText((s as any).risk_notes)
          if (rs) copyLines.push(`❓ ${rs}`)
          if (rd) copyLines.push(`◉ ${rd}`)
          if (rn) copyLines.push(`⚠️ ${rn}`)
          copyLines.push('')
        }
        if (learningPoints) copyLines.push(`🎯 教學重點：${learningPoints}`)
        const copyText = copyLines.join('\n')

        return {
          type: 'bubble',
          body: { type: 'box', layout: 'vertical', contents: bodyContents },
          footer: {
            type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
            contents: [{ type: 'button', action: { type: 'clipboard', label: '📋 一鍵複製', clipboardText: copyText }, style: 'secondary', height: 'sm', color: '#F0F0F0' }],
          },
        }
      }

      const bubbles = Array.from(byBatch.values()).map(buildBubble)

      // LINE 限制：一個 carousel 最多 10 bubbles → 多了拆成多則訊息
      const messages: any[] = []
      for (let i = 0; i < bubbles.length; i += 10) {
        const slice = bubbles.slice(i, i + 10)
        if (slice.length === 1) {
          messages.push({ type: 'flex', altText: `📖 ${expertName} 本週週記已發布（${signals.length} 筆操作）`, contents: slice[0] })
        } else {
          messages.push({ type: 'flex', altText: `📖 ${expertName} 本週週記已發布（${signals.length} 筆操作）`, contents: { type: 'carousel', contents: slice } })
        }
      }

      // Send normal content to subscribed users
      if (subscribedTargets.length > 0 && messages.length > 0) {
        for (let i = 0; i < subscribedTargets.length; i += 500) {
          const batch = subscribedTargets.slice(i, i + 500)
          const res = await fetch(LINE_MULTICAST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${channel.channel_access_token}` },
            body: JSON.stringify({ to: batch, messages: messages.slice(0, 5) }), // LINE 一次最多 5 則
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
