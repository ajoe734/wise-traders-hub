// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { buildNotificationRow, companyUrl } from '../_shared/routes.ts';
// 全庫知識審計 — 一次性掃 482 筆過舊條目並自動處置
//
// 兩層審計：
// 1) 量化層：對 backtestable=true 的條目呼叫 knowledge-backtest mode=full
//    （由 backtest 內建 auto_rules 套 archive / promote / grid_search）
// 2) 內容時效層：對其餘條目用「年份標記/Tag」掃描
//    - title/tags/fact 含過時年份（早於今年-1）→ lifecycle_status='rescue'
//    - 其餘 → 更新 last_validated_at = now() （視為內容仍適用）
//
// 完成後：寫 audit_logs、寄通知（依 knowledge_sync_settings.notify_user_ids）


const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

interface AuditItem {
  id: string
  category: string
  item_id: string
  title: string
  fact: string
  tags: string[] | null
  backtestable: boolean
  lifecycle_status: string
  last_validated_at: string | null
  win_rate: number | null
  sample_size: number | null
}

function isStaleByContent(item: AuditItem, currentYear: number): { stale: boolean; reason?: string } {
  const haystack = [
    item.title || '',
    item.fact || '',
    ...(Array.isArray(item.tags) ? item.tags : []),
  ].join(' ')

  // 找年份 token：2020～(currentYear-1) 視為過時錨點
  const yearMatches = haystack.match(/20\d{2}/g) ?? []
  const oldYears = yearMatches.map(y => Number(y)).filter(y => y >= 2020 && y < currentYear)
  const hasFutureYear = yearMatches.some(y => Number(y) >= currentYear)

  if (oldYears.length > 0 && !hasFutureYear) {
    return { stale: true, reason: `內容含過時年份標記：${oldYears.join(', ')}（早於 ${currentYear}）` }
  }
  // 含過時季度/半年標記
  const oldQuarter = haystack.match(/20(20|21|22|23|24)(H[12]|Q[1-4])/i)
  if (oldQuarter && !hasFutureYear) {
    return { stale: true, reason: `內容含過時時段標記：${oldQuarter[0]}` }
  }
  return { stale: false }
}

Deno.serve(withLogging('knowledge-full-audit', async (req) => {
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

  const sb = serviceClient()
  const startedAt = Date.now()

  try {
    // 1)) 載入所有 active 條目
    const { data: items, error: loadErr } = await sb
      .from('checkup_knowledge_items')
      .select('id,category,item_id,title,fact,tags,backtestable,lifecycle_status,last_validated_at,win_rate,sample_size')
      .eq('is_active', true)
    if (loadErr) throw loadErr

    const all = (items ?? []) as AuditItem[]
    const currentYear = new Date().getFullYear()

    // 2) 內容時效掃描
    const stale: AuditItem[] = []
    const fresh: AuditItem[] = []
    const staleReasons: Record<string, string> = {}
    for (const it of all) {
      const r = isStaleByContent(it, currentYear)
      if (r.stale) {
        stale.push(it)
        staleReasons[it.id] = r.reason!
      } else {
        fresh.push(it)
      }
    }

    // 3) 內容過時 → lifecycle_status='rescue'，並寫 audit_logs
    let rescuedCount = 0
    if (stale.length > 0) {
      const rescueIds = stale.map(s => s.id)
      const { error: rErr } = await sb
        .from('checkup_knowledge_items')
        .update({
          lifecycle_status: 'rescue',
          rescue_started_at: new Date().toISOString(),
          last_validated_at: new Date().toISOString(),
        })
        .in('id', rescueIds)
      if (!rErr) rescuedCount = rescueIds.length

      // 批次寫 audit_logs（每筆一條）
      const logs = stale.map(s => ({
        actor_id: null,
        action: 'knowledge.full_audit.content_stale',
        target_type: 'checkup_knowledge_items',
        target_id: s.id,
        detail: {
          category: s.category,
          title: s.title,
          reason: staleReasons[s.id],
          previous_lifecycle: s.lifecycle_status,
        },
      }))
      // 分批 insert，避免 payload 過大
      for (let i = 0; i < logs.length; i += 100) {
        await sb.from('audit_logs').insert(logs.slice(i, i + 100))
      }
    }

    // 4) 內容仍適用 → 更新 last_validated_at（讓 staleness 重置）
    let refreshedCount = 0
    if (fresh.length > 0) {
      const freshIds = fresh.map(f => f.id)
      // chunk update（PostgREST IN list 上限考量）
      for (let i = 0; i < freshIds.length; i += 200) {
        const chunk = freshIds.slice(i, i + 200)
        const { error: uErr } = await sb
          .from('checkup_knowledge_items')
          .update({ last_validated_at: new Date().toISOString() })
          .in('id', chunk)
        if (!uErr) refreshedCount += chunk.length
      }
    }

    // 5) 量化層：背景觸發 knowledge-backtest mode=full（不等回應，避免超時）
    let backtestTriggered = false
    try {
      sb.functions.invoke('knowledge-backtest', {
        body: { mode: 'full', trigger: 'full_audit' },
      }).catch((e) => console.error('backtest invoke failed:', e))
      backtestTriggered = true
    } catch (e) {
      console.error('backtest invoke threw:', e)
    }

    // 6) 寫總結 audit_log
    const summary = {
      total_items: all.length,
      stale_rescued: rescuedCount,
      fresh_revalidated: refreshedCount,
      backtestable_count: all.filter(i => i.backtestable).length,
      backtest_triggered: backtestTriggered,
      categories: ['chip_analysis', 'industry_trends', 'news_correlation', 'strategy_cases', 'technical_analysis']
        .map(cat => ({
          category: cat,
          total: all.filter(i => i.category === cat).length,
          rescued: stale.filter(i => i.category === cat).length,
        })),
      duration_ms: Date.now() - startedAt,
    }

    await sb.from('audit_logs').insert({
      actor_id: null,
      action: 'knowledge.full_audit.summary',
      target_type: 'checkup_knowledge_items',
      target_id: null,
      detail: summary,
    })

    // 7) 通知管理員
    try {
      const { data: settings } = await sb
        .from('knowledge_sync_settings')
        .select('notify_user_ids,notify_on_success')
        .limit(1).maybeSingle()
      const notifyIds = (settings?.notify_user_ids ?? []) as string[]
      if (settings?.notify_on_success && notifyIds.length > 0) {
        // 站內信
        const notifs = notifyIds.map(uid => buildNotificationRow({
          userId: uid,
          title: '📚 全庫知識審計完成',
          body: `共 ${summary.total_items} 筆條目：${summary.stale_rescued} 筆內容過時轉入 rescue 觀察、${summary.fresh_revalidated} 筆重新驗證通過。量化回測已背景啟動。`,
          type: 'info',
          link: companyUrl('knowledge-base'),
        }))
        await sb.from('notifications').insert(notifs)

        // Email（若有 RESEND_API_KEY）
        if (RESEND_API_KEY) {
          const { data: profiles } = await sb
            .from('profiles').select('user_id,display_name')
            .in('user_id', notifyIds)
          const emails = await Promise.all(
            notifyIds.map(async (uid) => {
              const { data: u } = await sb.auth.admin.getUserById(uid)
              return u?.user?.email
            })
          )
          const validEmails = emails.filter((e): e is string => !!e && !e.endsWith('@line.local'))
          if (validEmails.length > 0) {
            await fetch('https://api.resend.com/emails', {
              signal: AbortSignal.timeout(10000),
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: '海洋福星 <noreply@legendflow.tw>',
                to: validEmails,
                subject: '📚 全庫知識審計完成',
                html: `
                  <h2>全庫知識審計完成</h2>
                  <ul>
                    <li>掃描總數：<b>${summary.total_items}</b> 筆</li>
                    <li>內容過時轉入 rescue：<b>${summary.stale_rescued}</b> 筆</li>
                    <li>內容仍適用、已重新驗證：<b>${summary.fresh_revalidated}</b> 筆</li>
                    <li>可量化回測：<b>${summary.backtestable_count}</b> 筆（已背景啟動）</li>
                  </ul>
                  <h3>各分類分布</h3>
                  <table border="1" cellpadding="6" style="border-collapse:collapse">
                    <tr><th>分類</th><th>總數</th><th>轉 rescue</th></tr>
                    ${summary.categories.map(c =>
                      `<tr><td>${c.category}</td><td>${c.total}</td><td>${c.rescued}</td></tr>`
                    ).join('')}
                  </table>
                  <p style="color:#888">耗時 ${summary.duration_ms}ms · ${new Date().toISOString()}</p>
                `,
              }),
            }).catch(e => console.error('resend failed:', e))
          }
        }
      }
    } catch (notifyErr) {
      console.error('notify failed:', notifyErr)
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('full-audit error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
