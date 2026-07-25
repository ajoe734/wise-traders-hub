import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { classifyPublishError, buildMentorFailureNotification, isTransientError, retryTransient } from './classifyPublishError.ts'
import { parseUnitLockError } from '../_shared/parseUnitLockError.ts'


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
    altText: `📊 ${expertName} 本週發布 ${signalCount} 筆操作 — 立即重新訂閱！`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
    },
  }
}

Deno.serve(withLogging('publish-weekly-journals', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const runId = crypto.randomUUID().slice(0, 8)
  const t0 = Date.now()
  const fn = 'publish-weekly-journals'

  // 提早初始化 admin client，讓 emit 能持久化日誌
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseAdmin = supabaseUrl && serviceRoleKey
    ? serviceClient()
    : null

  const logBuffer: any[] = []
  const flushLogs = async () => {
    if (!supabaseAdmin || logBuffer.length === 0) return
    const rows = logBuffer.splice(0, logBuffer.length)
    try {
      await supabaseAdmin.from('function_run_logs').insert(rows)
    } catch (e) {
      console.error('[function_run_logs flush failed]', (e as any)?.message)
    }
  }

  // 統一結構化 JSON 日誌 + 人類可讀單行訊息 + DB 持久化
  const emit = (
    level: 'info' | 'warn' | 'error',
    msg: string,
    ctx: Record<string, unknown> = {},
  ) => {
    const stageVal = (ctx.stage ?? stage) as string | undefined
    const expertId = (ctx.expertId ?? null) as string | null
    const signalId = (ctx.signalId ?? null) as string | null
    const payload = {
      ts: new Date().toISOString(),
      level,
      fn,
      runId,
      stage: stageVal,
      expertId,
      signalId,
      msg,
      ...ctx,
    }
    const human = `[${fn}][${runId}]${stageVal ? `[stage=${stageVal}]` : ''}${
      expertId ? `[expert=${expertId}]` : ''
    }${signalId ? `[signal=${signalId}]` : ''} ${msg}`
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    out(human)
    out(JSON.stringify(payload))
    logBuffer.push({
      fn,
      run_id: runId,
      level,
      stage: stageVal ?? null,
      msg,
      expert_id: expertId,
      signal_id: signalId,
      payload,
    })
  }
  const log = (msg: string, ctx: Record<string, unknown> = {}) => emit('info', msg, { stage, ...ctx })
  const logErr = (stageName: string, err: unknown, extra: Record<string, unknown> = {}) => {
    const e = err as any
    emit('error', `FAILED: ${e?.message ?? String(err)}`, {
      stage: stageName,
      err: {
        name: e?.name,
        message: e?.message ?? String(err),
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        status: e?.status,
        stack: e?.stack,
      },
      ...extra,
    })
  }

  let stage = 'init'
  try {
    if (!supabaseUrl || !serviceRoleKey || !supabaseAdmin) {
      const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
      emit('error', 'Missing required env', { stage: 'init', missing })
      await flushLogs()
      return new Response(JSON.stringify({ error: 'Missing required env', missing, runId }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    log('Function start')

    // ── Parse body: 支援手動觸發（提前發布）與市場批次過濾 ─────────────
    // body 形態：
    //   {} 或 {}                             → cron 完整批次（歷史行為）
    //   { market: 'TW' | 'US' }              → 只發布指定市場老師的 pending
    //   { expert_id: uuid, force: true }     → 老師手動提前發布本人本週 pending
    stage = 'parse_body'
    let body: { expert_id?: string; market?: 'TW' | 'US'; force?: boolean } = {}
    if (req.method === 'POST') {
      try {
        const raw = await req.text()
        if (raw.trim()) body = JSON.parse(raw)
      } catch {
        body = {}
      }
    }

    // 手動 force 模式：驗證呼叫者為該 expert.user_id 或 company_admin
    let filterExpertIds: string[] | null = null
    // (market batch mode: filterExpertIds carries the resolved list)
    if (body.force && body.expert_id) {
      stage = 'authorize_force'
      const { data: authUser } = await supabaseAdmin.auth.getUser(
        (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''),
      )
      const callerId = authUser?.user?.id || null
      if (!callerId) {
        await flushLogs()
        return new Response(JSON.stringify({ error: 'unauthorized', runId }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { data: expertRow } = await supabaseAdmin
        .from('experts').select('id, user_id').eq('id', body.expert_id).maybeSingle()
      const { data: roleRow } = await supabaseAdmin
        .from('user_roles').select('role').eq('user_id', callerId).eq('role', 'company_admin').maybeSingle()
      const isOwner = expertRow?.user_id === callerId
      const isAdmin = !!roleRow
      if (!isOwner && !isAdmin) {
        await flushLogs()
        return new Response(JSON.stringify({ error: 'forbidden', runId }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      filterExpertIds = [body.expert_id]
      log('Force publish authorized', { expertId: body.expert_id, isOwner, isAdmin })
    } else if (body.market === 'TW' || body.market === 'US') {
      stage = 'filter_by_market'
      // 依 experts.asset_class 決定 TW / US 老師 id 清單
      const usClasses = ['us_stock', 'us_futures', 'crypto']
      const query = supabaseAdmin.from('experts').select('id, asset_class')
      const { data: allExperts } = await query
      const matched = (allExperts || []).filter((e: any) => {
        const c = (e.asset_class || '').toLowerCase()
        const isUs = usClasses.includes(c)
        return body.market === 'US' ? isUs : !isUs
      }).map((e: any) => e.id)
      filterExpertIds = matched
      // market-scoped batch: publish only pending signals for this cohort
      log(`Market batch: ${body.market} experts=${matched.length}`)
      if (matched.length === 0) {
        await flushLogs()
        return new Response(JSON.stringify({ published: 0, pushed: 0, runId, market: body.market }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    stage = 'fetch_pending_signals'
    let pendingQuery = supabaseAdmin
      .from('expert_signals')
      .select('id, expert_id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, teaching_topic, overall_summary, published_at, batch_id, executed_at')
      .eq('status', 'pending')
    if (filterExpertIds) pendingQuery = pendingQuery.in('expert_id', filterExpertIds)
    const { data: pendingSignals, error: fetchErr } = await pendingQuery

    if (fetchErr) {
      logErr(stage, fetchErr)
      await flushLogs()
      return new Response(JSON.stringify({ error: fetchErr.message, stage, runId }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!pendingSignals || pendingSignals.length === 0) {
      log('No pending signals to publish')
      await flushLogs()
      return new Response(JSON.stringify({ published: 0, pushed: 0, runId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    log(`Found ${pendingSignals.length} pending signals`)

    stage = 'mark_published'
    // 依 instrument 判別市場，回填 expert_signals.market；同 batch 逐一 update 以帶入正確 market
    const { detectMarket, isDerivativeMarket, currencyOf } = await import('../_shared/marketDetect.ts')

    // 預先撈 expert → user_id 供發布失敗時通知導師本人
    const expertIds = Array.from(new Set(pendingSignals.map(s => s.expert_id)))
    const { data: expertRows } = await supabaseAdmin
      .from('experts')
      .select('id, user_id, name')
      .in('id', expertIds)
    const expertMap = new Map<string, { user_id: string | null; name: string | null }>()
    for (const e of expertRows || []) expertMap.set((e as any).id, { user_id: (e as any).user_id, name: (e as any).name })

    // 將 DB 例外分類為可讀原因 + 修正路徑 → 抽出到 classifyPublishError.ts 以便單元測試


    const publishFailures: Array<{ signal_id: string; expert_id: string; kind: string; message: string; attempts: number }> = []
    const publishedIds: string[] = []
    const retryStats = { totalRetries: 0, transientRecovered: 0 }
    for (const s of pendingSignals) {
      const detected = detectMarket((s as any).instrument)
      const market = isDerivativeMarket(detected) ? 'US' : detected
      let attempts = 0
      let updateErr: any = null
      try {
        const { attempts: n } = await retryTransient(
          async () => {
            const { error } = await supabaseAdmin
              .from('expert_signals')
              .update({ status: 'published', market })
              .eq('id', s.id)
            if (error) throw error
            return true
          },
          {
            maxAttempts: 3,
            baseDelayMs: 200,
            onRetry: (attempt, err) => {
              retryStats.totalRetries++
              emit('warn', `Transient publish error, retrying`, {
                stage: 'mark_published_retry',
                signalId: s.id,
                expertId: s.expert_id,
                attempt,
                errCode: (err as any)?.code,
                errMsg: (err as any)?.message,
              })
            },
          },
        )
        attempts = n
        if (n > 1) retryStats.transientRecovered++
      } catch (err) {
        updateErr = err
        attempts = 3
      }

      if (updateErr) {
        const info = classifyPublishError(updateErr, (s as any).instrument)
        publishFailures.push({ signal_id: s.id, expert_id: s.expert_id, kind: info.kind, message: (updateErr as any)?.message ?? String(updateErr), attempts })
        logErr('mark_published_iter', updateErr, { signalId: s.id, expertId: s.expert_id, kind: info.kind, attempts, transient: isTransientError(updateErr) })

        // 若是單位鎖被擋下，非同步寫入審計 + 系統告警（新交易，不受本次 rollback 影響）
        const unitLock = parseUnitLockError(updateErr)
        if (unitLock) {
          try {
            await supabaseAdmin.rpc('log_unit_lock_violation', {
              payload: {
                ...unitLock,
                expert_id: unitLock.expert_id || s.expert_id,
                signal_id: s.id,
                attempted_row_id: s.id,
                caller: 'publish-weekly-journals',
              },
            })
          } catch (auditErr) {
            logErr('log_unit_lock_violation_failed', auditErr, { signalId: s.id, expertId: s.expert_id })
          }
        }

        // 通知導師本人（可點擊連結直達修正入口）
        const mentor = expertMap.get(s.expert_id)
        if (mentor?.user_id) {
          try {
            await supabaseAdmin.from('notifications').insert(
              buildMentorFailureNotification({
                mentorUserId: mentor.user_id,
                signalId: s.id,
                info,
              }),
            )
          } catch (nErr) {
            logErr('notify_mentor_failed', nErr, { signalId: s.id, expertId: s.expert_id })
          }
        }
        continue
      }
      publishedIds.push(s.id)
    }


    log(`Published ${publishedIds.length}/${pendingSignals.length} signals (failed=${publishFailures.length}, retries=${retryStats.totalRetries}, recovered=${retryStats.transientRecovered})`, {
      failedByKind: publishFailures.reduce((acc: Record<string, number>, f) => { acc[f.kind] = (acc[f.kind] || 0) + 1; return acc }, {}),
      retryStats,
    })

    // 只保留成功發布的 signals 進入後續 trade_signals sync / LINE push，避免對失敗案例做副作用
    const failedIdSet = new Set(publishFailures.map(f => f.signal_id))
    const publishedSignals = pendingSignals.filter(s => !failedIdSet.has(s.id))

    // Sync trade_signals + user_performances for each published signal
    stage = 'sync_trade_signals'
    let syncOk = 0, syncFail = 0
    for (const signal of publishedSignals) {
      try {
      // 'teaching' (純教學週記) / 'hold' (觀察) 不影響 trade_signals 或 user_performances
      if (signal.action === 'teaching' || signal.action === 'hold') {
        syncOk++
        continue
      }

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
        logErr('sync_trade_signals_iteration', innerErr, { signalId: signal.id, expertId: signal.expert_id, instrument: signal.instrument, action: signal.action })
      }
    }

    log(`Trade signals synced (ok=${syncOk}, fail=${syncFail})`)

    // Group by expert_id for LINE push
    stage = 'group_by_expert'
    const byExpert = new Map<string, typeof publishedSignals>()
    for (const signal of publishedSignals) {
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
        emit('warn', 'No active LINE channel', { stage, expertId })
        continue
      }

      // Get expert name + slug（slug 用於通知深連結）
      const { data: expert } = await supabaseAdmin
        .from('experts')
        .select('name, slug')
        .eq('id', expertId)
        .single()

      // Get active subscriber LINE targets — split subscribed vs canceled
      const { data: bindings } = await supabaseAdmin
        .from('member_line_bindings')
        .select('line_user_id, user_id')
        .eq('expert_id', expertId)
        .eq('is_active', true)

      if (!bindings || bindings.length === 0) {
        emit('warn', 'No LINE bindings', { stage, expertId })
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

      // 提前發布：對訂閱者發站內通知「本週週記已提前開放」
      if (body.force === true && subscribedUserIds.size > 0) {
        const expertName = expert?.name || '導師'
        const slug = (expert as any)?.slug || null
        const link = slug ? `/app/expert/${slug}` : '/account/notifications'
        const notifRows = Array.from(subscribedUserIds).map((uid) => ({
          user_id: uid,
          title: `${expertName} 本週週記已提前開放`,
          body: `${expertName} 老師提前公開本週 ${signals.length} 筆操作紀錄，點此立即查看。`,
          type: 'info',
          link,
        }))
        try {
          const { error: notifErr } = await supabaseAdmin.from('notifications').insert(notifRows)
          if (notifErr) {
            emit('warn', 'insert early-publish notifications failed', { stage: 'notify_subscribers_early', expertId, count: notifRows.length, err: notifErr.message })
          } else {
            emit('info', 'Early-publish notifications sent', { stage: 'notify_subscribers_early', expertId, count: notifRows.length })
          }
        } catch (nErr) {
          logErr('notify_subscribers_early', nErr, { expertId, count: notifRows.length })
        }
      }


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
            emit('info', 'LINE push ok (subscribed)', { stage, expertId, count: batch.length })
          } else {
            const errBody = await res.text()
            emit('error', 'LINE push failed (subscribed)', { stage, expertId, status: res.status, body: errBody })
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
            emit('info', 'LINE promo push ok (canceled)', { stage, expertId, count: batch.length })
          } else {
            const errBody = await res.text()
            emit('error', 'LINE promo push failed (canceled)', { stage, expertId, status: res.status, body: errBody })
          }
        }
      }
     } catch (expertErr) {
       pushFail++
       logErr('line_push_iteration', expertErr, { expertId })
     }
    }

    const elapsedMs = Date.now() - t0
    log(`Done. published=${publishedIds.length} failed=${publishFailures.length} pushed=${totalPushed} pushFail=${pushFail} elapsedMs=${elapsedMs}`)
    await flushLogs()
    return new Response(JSON.stringify({
      runId,
      published: publishedIds.length,
      failed: publishFailures.length,
      failures: publishFailures,
      pushed: totalPushed,
      pushFail,
      syncOk,
      syncFail,
      retryStats,
      elapsedMs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    logErr(stage, err)
    await flushLogs()
    const e = err as any
    return new Response(JSON.stringify({
      error: e?.message ?? 'Internal server error',
      stage,
      runId,
      name: e?.name,
      code: e?.code,
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
