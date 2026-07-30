// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

// 手動續訂模型：每日 09:00 (UTC+8) 推播到期前 7 / 3 / 1 天的訂閱者，
// 帶一鍵續訂連結（/{slug}/checkout?plan={plan_id}）。
// 平台不會自動扣款，過期即斷權，無寬限期。

// W4-1: 擴充 T-0（當日到期）與 T+1（已過期 24h 內召回）
const REMINDER_DAYS = [7, 3, 1, 0, -1] as const

function buildRenewalFlexMessage(
  expertName: string,
  planName: string,
  daysLeft: number,
  expiresAt: string,
  amount: number,
  renewUrl: string,
) {
  const expiryDate = new Date(expiresAt).toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const headerText = daysLeft < 0
    ? '🔔 訂閱已過期 — 24h 內可回購保留資料'
    : daysLeft === 0
      ? '⚠️ 訂閱今日到期'
      : daysLeft <= 1
        ? '⚠️ 訂閱明日到期'
        : daysLeft <= 3
          ? '⏳ 訂閱即將到期'
          : '⏰ 訂閱到期提醒'

  return {
    type: 'flex',
    altText: `${headerText}：${expertName}・${planName}（剩 ${daysLeft} 天）`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF3CD',
        paddingAll: 'lg',
        contents: [{
          type: 'text', text: headerText,
          weight: 'bold', size: 'lg', color: '#856404',
        }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: expertName, weight: 'bold', size: 'xl', color: '#333333' },
          { type: 'text', text: planName, size: 'sm', color: '#666666', margin: 'sm' },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'horizontal', margin: 'lg',
            contents: [
              { type: 'text', text: '到期日', size: 'sm', color: '#999999', flex: 1 },
              { type: 'text', text: expiryDate, size: 'sm', color: '#333333', align: 'end', flex: 2 },
            ],
          },
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '剩餘天數', size: 'sm', color: '#999999', flex: 1 },
              { type: 'text', text: `${daysLeft} 天`, size: 'sm', color: '#DC3545', weight: 'bold', align: 'end', flex: 2 },
            ],
          },
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '續訂金額', size: 'sm', color: '#999999', flex: 1 },
              { type: 'text', text: `NT$${amount.toLocaleString()}`, size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 2 },
            ],
          },
          { type: 'separator', margin: 'lg' },
          {
            type: 'text',
            text: '本平台採單次扣款，到期後不會自動扣款。如需延續服務，請於到期前完成續訂，否則將無法繼續存取訊號與內容。',
            size: 'xs', color: '#666666', margin: 'lg', wrap: true,
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: '#856404',
          action: { type: 'uri', label: '立即續訂', uri: renewUrl },
        }],
      },
    },
  }
}

Deno.serve(withLogging('line-push-renewal-reminder', async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const siteUrl = (Deno.env.get('SITE_URL') || 'https://legendflow.tw').replace(/\/$/, '')
    const now = new Date()

    // 一次掃 7 / 3 / 1 三個窗口
    const allTargets: Array<{
      sub: any; daysLeft: number; expertId: string; expertName: string; expertSlug: string;
      planId: string; planName: string; amount: number;
    }> = []

    for (const d of REMINDER_DAYS) {
      const lower = new Date(now.getTime() + d * 24 * 60 * 60 * 1000)
      const upper = new Date(now.getTime() + (d + 1) * 24 * 60 * 60 * 1000)

      // W4-1: T+1 召回需查 expired 訂閱（已被 expire-subscriptions cron 設為 expired）
      const targetStatus = d < 0 ? 'expired' : 'active'
      const query = supabaseAdmin
        .from('member_subscriptions')
        .select('id, user_id, plan_id, expires_at, canceled_at, billing_cycle, expert_plans!inner(id, expert_id, name, price_monthly, price_yearly, experts!inner(id, name, slug))')
        .eq('status', targetStatus)
        .is('canceled_at', null)
        .gte('expires_at', lower.toISOString())
        .lt('expires_at', upper.toISOString())

      const { data: subs, error } = await query

      if (error) {
        console.error(`Query error for ${d}d window:`, error.message)
        continue
      }
      for (const sub of subs || []) {
        const plan: any = sub.expert_plans
        const expert: any = plan.experts
        const cycle = (sub as any).billing_cycle === 'yearly' ? 'yearly' : 'monthly'
        const amount = cycle === 'yearly'
          ? (plan.price_yearly || (plan.price_monthly || 0) * 12)
          : (plan.price_monthly || 0)
        allTargets.push({
          sub: { ...sub, billing_cycle: cycle },
          daysLeft: d,
          expertId: expert.id,
          expertName: expert.name,
          expertSlug: expert.slug,
          planId: plan.id,
          planName: plan.name,
          amount,
        })
      }
    }

    console.log(`Found ${allTargets.length} reminder targets across 7/3/1 day windows`)

    if (allTargets.length === 0) {
      return new Response(JSON.stringify({ reminded: 0, details: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 抓 LINE 綁定 + 通道
    const channelCache = new Map<string, string | null>()
    let totalPushed = 0
    const results: any[] = []

    for (const t of allTargets) {
      const { data: binding } = await supabaseAdmin
        .from('member_line_bindings')
        .select('line_user_id')
        .eq('user_id', t.sub.user_id)
        .eq('expert_id', t.expertId)
        .eq('is_active', true)
        .maybeSingle()
      if (!binding) continue

      let token = channelCache.get(t.expertId)
      if (token === undefined) {
        const { data: ch } = await supabaseAdmin
          .from('expert_line_channels')
          .select('channel_access_token, is_active')
          .eq('expert_id', t.expertId)
          .single()
        token = ch?.is_active && ch?.channel_access_token ? ch.channel_access_token : null
        channelCache.set(t.expertId, token)
      }
      if (!token) continue

      const cycle = (t.sub as any).billing_cycle === 'yearly' ? 'yearly' : 'monthly'
      const renewUrl = renewalUrl(t.expertSlug, t.planId, {
        baseUrl: siteUrl,
        query: {
          cycle,
          utm_source: 'line',
          utm_medium: 'renewal',
          utm_campaign: `d${t.daysLeft}`,
        },
      })

      const message = buildRenewalFlexMessage(
        t.expertName, t.planName, t.daysLeft,
        t.sub.expires_at!, t.amount, renewUrl,
      )

      // Idempotency: skip if this (sub, days_left) reminder was already sent today (UTC+8).
      // Defends against double cron runs and manual re-triggers.
      const tzOffsetMs = 8 * 60 * 60 * 1000;
      const dayStart = new Date(Math.floor((Date.now() + tzOffsetMs) / 86400000) * 86400000 - tzOffsetMs);
      const { data: dupe } = await supabaseAdmin
        .from('audit_logs')
        .select('id')
        .eq('action', 'subscription.renewal_reminder_sent')
        .eq('target_id', t.sub.id)
        .gte('created_at', dayStart.toISOString())
        .contains('detail', { days_left: t.daysLeft })
        .limit(1)
        .maybeSingle();
      if (dupe) {
        results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'skipped_dedupe' });
        continue;
      }

      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        signal: AbortSignal.timeout(10000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ to: binding.line_user_id, messages: [message] }),
      })

      if (res.ok) {
        totalPushed++
        // 記入 audit log
        await supabaseAdmin.from('audit_logs').insert({
          actor_id: t.sub.user_id,
          action: 'subscription.renewal_reminder_sent',
          target_type: 'member_subscription',
          target_id: t.sub.id,
          detail: { days_left: t.daysLeft, expert_id: t.expertId, plan_id: t.planId },
        })
        results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'pushed' })
      } else {
        const errBody = await res.text()
        console.error(`LINE push failed for sub ${t.sub.id}:`, res.status, errBody)
        results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'failed', error: errBody })
      }
    }

    console.log(`Total reminded: ${totalPushed} / ${allTargets.length}`)

    return new Response(JSON.stringify({ reminded: totalPushed, total_targets: allTargets.length, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('line-push-renewal-reminder error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
