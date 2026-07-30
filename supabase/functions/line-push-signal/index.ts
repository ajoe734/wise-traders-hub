// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { resolveLinePushQuantityUnit, type LinePushExpertHint } from './quantityUnit.ts'

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

// R4: share-og 公開預覽 URL（crawler 抓 OG，人類自動跳回 in-app URL）
const SHARE_OG_BASE = `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/share-og`
const buildSignalShareUrl = (id: string) => `${SHARE_OG_BASE}/signal/${encodeURIComponent(id)}`
const buildJournalShareUrl = (id: string) => `${SHARE_OG_BASE}/journal/${encodeURIComponent(id)}`

// 把 TipTap HTML 轉純文字（LINE Flex text 節點不接受 HTML 標籤）
function htmlToText(s: any): string {
  if (s == null) return ''
  const str = String(s)
  if (!/<[^>]+>/.test(str)) return str
  return str
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
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

// 對 signal 物件中的富文字欄位做 HTML→純文字
function plainifySignal(signal: any) {
  if (!signal) return signal
  const fields = ['reason_summary', 'reason_detail', 'risk_notes', 'learning_points', 'overall_summary', 'teaching_topic']
  const out: any = { ...signal }
  for (const f of fields) {
    if (out[f]) out[f] = htmlToText(out[f])
  }
  return out
}

export function buildFlexMessage(rawSignal: any, type: 'publish' | 'takedown' | 'update' = 'publish', expertHint?: LinePushExpertHint | null) {
  const signal = plainifySignal(rawSignal)
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

  // Default: publish or update message
  const isUpdate = type === 'update'
  const isBullish = ['buy', 'add'].includes(signal.action)
  const color = isUpdate ? '#FF8C00' : (isBullish ? '#00B900' : '#DC3545')

  // 憲法：quantity 單位一律由 resolveLinePushQuantityUnit 決定
  // （signal.asset_class → expertHint → currency=USD → tw_stock），
  // 徹底杜絕 us_stock/us_future 被誤印為「張」。
  const unit = resolveLinePushQuantityUnit(signal, expertHint || null)
  const qtyLabel = signal.quantity ? `(${signal.quantity}${unit})` : ''
  const headerLine = isUpdate ? `🔄 訊號更新通知\n【${label} ${signal.instrument}】` : `【${label} ${signal.instrument}】`
  const copyLines: string[] = [headerLine]
  if (signal.price_hint) copyLines.push(`參考價位：${signal.price_hint}${qtyLabel}`)
  if (signal.teaching_topic) copyLines.push(`\n📚 教學主題：\n${signal.teaching_topic}`)
  if (signal.overall_summary) copyLines.push(`\n📝 整體摘要：\n${signal.overall_summary}`)
  if (signal.reason_summary) copyLines.push(`\n❓ 為什麼這樣操作？\n${signal.reason_summary}`)
  if (signal.reason_detail) copyLines.push(`\n◉ 部位控管想法：\n${signal.reason_detail}`)
  if (signal.risk_notes) copyLines.push(`\n⚠️ 風險提醒：\n${signal.risk_notes}`)
  if (signal.learning_points) copyLines.push(`\n🎯 教學重點：\n${signal.learning_points}`)
  // R4: 把 share-og 連結附在純文字尾端（複製出去也帶得走 OG 預覽）
  const shareUrl = signal.id ? buildSignalShareUrl(signal.id) : null
  if (shareUrl) copyLines.push(`\n🔗 查看詳情：${shareUrl}`)
  const copyText = copyLines.join('\n')

  const bodyContents: any[] = []

  if (isUpdate) {
    bodyContents.push({
      type: 'text',
      text: '🔄 訊號更新通知',
      weight: 'bold',
      size: 'sm',
      color: '#FF8C00',
    })
  }

  bodyContents.push({
    type: 'text',
    text: `${label} ${signal.instrument}`,
    weight: 'bold',
    size: 'xl',
    color,
    margin: isUpdate ? 'sm' : 'none',
  })

  if (signal.price_hint) {
    const qtyText = signal.quantity ? `(${signal.quantity}${unit})` : ''
    bodyContents.push({
      type: 'text',
      text: `參考價位：${signal.price_hint}${qtyText}`,
      size: 'sm',
      color: '#666666',
      margin: 'md',
    })
  }

  if (signal.teaching_topic) {
    bodyContents.push(
      { type: 'text', text: '📚 教學主題', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.teaching_topic, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  if (signal.overall_summary) {
    bodyContents.push(
      { type: 'text', text: '📝 整體摘要', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.overall_summary, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  if (signal.reason_summary) {
    bodyContents.push(
      { type: 'text', text: '❓ 為什麼這樣操作？', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.reason_summary, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  if (signal.reason_detail) {
    bodyContents.push(
      { type: 'text', text: '◉ 部位控管想法', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.reason_detail, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  if (signal.risk_notes) {
    bodyContents.push(
      { type: 'text', text: '⚠️ 風險提醒', size: 'sm', color: '#DC3545', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.risk_notes, size: 'xs', color: '#999999', margin: 'sm', wrap: true },
    )
  }

  if (signal.learning_points) {
    bodyContents.push(
      { type: 'text', text: '🎯 教學重點', size: 'sm', color: '#333333', margin: 'lg', weight: 'bold' },
      { type: 'text', text: signal.learning_points, size: 'sm', color: '#444444', margin: 'sm', wrap: true },
    )
  }

  const footerButtons: any[] = [
    {
      type: 'button',
      action: { type: 'clipboard', label: '📋 一鍵複製', clipboardText: copyText },
      style: 'secondary',
      height: 'sm',
      color: '#F0F0F0',
    },
  ]
  // R4: 加上「查看詳情」URI 按鈕（指向 share-og，crawler 抓 OG／人類跳回 in-app）
  if (shareUrl) {
    footerButtons.unshift({
      type: 'button',
      action: { type: 'uri', label: '🔗 查看詳情', uri: shareUrl },
      style: 'primary',
      height: 'sm',
      color: color,
    })
  }
  const footer = {
    type: 'box',
    layout: 'vertical',
    contents: footerButtons,
    spacing: 'sm',
    paddingAll: 'lg',
  }

  const altPrefix = isUpdate ? '🔄 訊號更新通知 - ' : ''
  return {
    type: 'flex',
    altText: `${altPrefix}${label} ${signal.instrument}${signal.price_hint ? ` @ ${signal.price_hint}` : ''}`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer,
    },
  }
}

// Build a performance marketing message for canceled subscribers
function buildPromoMessage(expertName: string, performance: any) {
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
      text: '分析師剛發布了新的操作訊號，以下是最新績效表現：',
      size: 'sm',
      color: '#666666',
      margin: 'md',
      wrap: true,
    },
    { type: 'separator', margin: 'lg' },
  ]

  if (performance) {
    const winRate = performance.win_rate != null ? `${Number(performance.win_rate).toFixed(1)}%` : '-'
    const cumReturn = performance.total_return_pct != null ? `${Number(performance.total_return_pct).toFixed(1)}%` : '-'
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
    altText: `📊 ${expertName} 最新績效更新 — 立即重新訂閱跟上操作！`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
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
    return { subscribedTargets: [], canceledTargets: [], reason: 'no_bindings' }
  }

  const bindingUserIds = bindings.map((b: any) => b.user_id)

  // ISSUE-011: Get subscriptions that are active AND not yet expired
  const { data: activeSubs } = await supabaseAdmin
    .from('member_subscriptions')
    .select('user_id, plan_id, canceled_at, expires_at')
    .in('user_id', bindingUserIds)
    .eq('status', 'active')

  const { data: expertPlans } = await supabaseAdmin
    .from('expert_plans')
    .select('id')
    .eq('expert_id', expert_id)

  const expertPlanIds = new Set((expertPlans || []).map((p: any) => p.id))
  const now = new Date().toISOString()

  // Filter: must belong to this expert's plans AND not expired
  const relevantSubs = (activeSubs || []).filter((s: any) => {
    if (!expertPlanIds.has(s.plan_id)) return false
    // ISSUE-011: Check expires_at — if set, must be in the future
    if (s.expires_at && s.expires_at < now) return false
    return true
  })

  const subscribedUserIds = new Set(relevantSubs.filter((s: any) => !s.canceled_at).map((s: any) => s.user_id))
  const canceledUserIds = new Set(relevantSubs.filter((s: any) => s.canceled_at).map((s: any) => s.user_id))

  const subscribedTargets = bindings
    .filter((b: any) => subscribedUserIds.has(b.user_id))
    .map((b: any) => b.line_user_id)

  const canceledTargets = bindings
    .filter((b: any) => canceledUserIds.has(b.user_id))
    .map((b: any) => b.line_user_id)

  return { subscribedTargets, canceledTargets, reason: subscribedTargets.length === 0 && canceledTargets.length === 0 ? 'no_active_subscribers' : null }
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

Deno.serve(withLogging('line-push-signal', async (req) => {
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

    const supabaseAdmin = serviceClient()

    const supabaseUser = userClient(req)

    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userError } = await supabaseUser.auth.getUser(token)
    if (userError || !userData?.user) {
      console.error('Auth getUser failed:', userError?.message)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = userData.user.id
    console.log('Caller:', userId)

    const body = await req.json()
    const { validateInput, validationJsonResponse } = await import('../_shared/inputValidator.ts')
    const issues = validateInput({
      fields: {
        expert_id: { required: true, type: 'string', label: 'expert_id' },
        signal_id: { required: false, type: 'string', label: 'signal_id' },
        type: { required: false, type: 'string', label: 'type', oneOf: ['publish', 'takedown', 'update'] },
        mode: { required: false, type: 'string', label: 'mode' },
        is_update: { required: false, type: 'boolean', label: 'is_update' },
        batch_id: { required: false, type: 'string', label: 'batch_id' },
        signal_data: { required: false, type: 'object', label: 'signal_data' },
      },
      source: body,
    })
    if (issues.length) return validationJsonResponse(issues)
    const { signal_id, expert_id, type, mode, signal_data, is_update, batch_id } = body
    const pushType: 'publish' | 'takedown' | 'update' = type === 'takedown' ? 'takedown' : (is_update ? 'update' : 'publish')
    console.log('Push request:', { signal_id, expert_id, pushType, mode, is_update })

    // Verify caller is analyst of this expert OR company_admin
    const { data: expertRow } = await supabaseAdmin
      .from('experts').select('id, user_id, role, name, asset_class, currency').eq('id', expert_id).single()
    const expertHint: LinePushExpertHint = {
      asset_class: expertRow?.asset_class ?? null,
      currency: expertRow?.currency ?? null,
    }

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

    // Get targets split by subscription status
    const { subscribedTargets, canceledTargets, reason } = await getTargets(supabaseAdmin, expert_id)

    // Get expert performance for promo message (for canceled users)
    let performance: any = null
    if (canceledTargets.length > 0) {
      const { data: perfData } = await supabaseAdmin.rpc('calculate_expert_performance', { _expert_id: expert_id })
      performance = perfData
    }

    // MODE: preview — push inline signal_data to LINE without DB
    if (mode === 'preview' && signal_data) {
      console.log('Preview mode: pushing inline signal data to LINE, type:', pushType)
      const message = buildFlexMessage(signal_data, pushType, expertHint)

      let totalPushed = 0
      if (subscribedTargets.length > 0) {
        totalPushed += await sendToLine(channel.channel_access_token, subscribedTargets, message)
      }

      // Send promo to canceled subscribers
      if (canceledTargets.length > 0) {
        const promoMsg = buildPromoMessage(expertRow.name, performance)
        totalPushed += await sendToLine(channel.channel_access_token, canceledTargets, promoMsg)
        console.log(`Promo pushed to ${canceledTargets.length} canceled users`)
      }

      console.log('Preview push total:', totalPushed)
      return new Response(JSON.stringify({ pushed: true, count: totalPushed, subscribed: subscribedTargets.length, canceled: canceledTargets.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Batch mode: push all signals in one batch as a Flex carousel
    if (batch_id) {
      console.log('Batch mode for batch_id:', batch_id)
      const { data: batchSignals } = await supabaseAdmin
        .from('expert_signals')
        .select('*')
        .eq('expert_id', expert_id)
        .eq('batch_id', batch_id)
        .order('executed_at', { ascending: true, nullsFirst: false })

      if (!batchSignals || batchSignals.length === 0) {
        return new Response(JSON.stringify({ error: 'Batch not found or empty' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // 一隻 carousel 最多 10 個 bubble
      const bubbles = batchSignals.slice(0, 10).map((s: any) => {
        const flex = buildFlexMessage(s, pushType, expertHint)
        return flex.contents // bubble 物件
      })
      const firstLabel = batchSignals[0]?.instrument || ''
      const carouselMsg = {
        type: 'flex',
        altText: `📒 週記發布：${firstLabel}${batchSignals.length > 1 ? ` 等 ${batchSignals.length} 檔` : ''}`,
        contents: { type: 'carousel', contents: bubbles },
      }

      let totalPushed = 0
      if (subscribedTargets.length > 0) {
        totalPushed += await sendToLine(channel.channel_access_token, subscribedTargets, carouselMsg)
      }
      if (canceledTargets.length > 0) {
        const promoMsg = buildPromoMessage(expertRow.name, performance)
        totalPushed += await sendToLine(channel.channel_access_token, canceledTargets, promoMsg)
      }

      // mark line_pushed_at on all signals in this batch
      if (totalPushed > 0) {
        await supabaseAdmin.from('expert_signals')
          .update({ line_pushed_at: new Date().toISOString() })
          .eq('batch_id', batch_id)
      }

      return new Response(JSON.stringify({
        pushed: totalPushed > 0,
        count: totalPushed,
        bubbles: bubbles.length,
        batch_size: batchSignals.length,
        subscribed: subscribedTargets.length,
        canceled: canceledTargets.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Standard mode: fetch signal from DB
    if (!signal_id) {
      console.error('Missing signal_id')
      return new Response(JSON.stringify({ error: 'Missing signal_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    const message = buildFlexMessage(signal, pushType, expertHint)
    console.log('Subscribed targets:', subscribedTargets.length, 'Canceled targets:', canceledTargets.length)

    let totalPushed = 0

    // Send normal content to subscribed users
    if (subscribedTargets.length > 0) {
      totalPushed += await sendToLine(channel.channel_access_token, subscribedTargets, message)
    }

    // Send promo to canceled users
    if (canceledTargets.length > 0) {
      const promoMsg = buildPromoMessage(expertRow.name, performance)
      totalPushed += await sendToLine(channel.channel_access_token, canceledTargets, promoMsg)
      console.log(`Promo pushed to ${canceledTargets.length} canceled users`)
    }

    if (totalPushed === 0 && subscribedTargets.length === 0 && canceledTargets.length === 0) {
      return new Response(JSON.stringify({ pushed: false, reason: reason || 'no_bindings', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Total pushed:', totalPushed)

    // Audit log for repush operations (company_admin can insert; analyst owners may not)
    if (is_update && isAdmin) {
      try {
        await supabaseAdmin.from('audit_logs').insert({
          actor_id: userId,
          action: 'signal_repush',
          target_type: 'expert_signal',
          target_id: signal_id,
          detail: { expert_id, instrument: signal.instrument, action: signal.action, count: totalPushed },
        })
      } catch (e) {
        console.error('audit_logs insert failed:', e)
      }
    } else if (is_update) {
      // Analyst owner: log via a separate channel — we still mark line_pushed_at
    }

    // Update line_pushed_at timestamp on repush
    if (is_update && totalPushed > 0) {
      await supabaseAdmin.from('expert_signals')
        .update({ line_pushed_at: new Date().toISOString() })
        .eq('id', signal_id)
    }

    return new Response(JSON.stringify({ pushed: true, count: totalPushed, subscribed: subscribedTargets.length, canceled: canceledTargets.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('line-push-signal error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
