// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
// supabase/functions/refresh-targets-weekly/index.ts
// 每週自動刷新「過去 30 天有登入」用戶的持股目標價，
// 將變動寫入 target_price_history，並在有變動時發 notification + function_run_logs。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { corsHeaders } from '../_shared/cors.ts';

import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { accountNotificationsUrl, buildNotificationRow } from '../_shared/routes.ts';
const FN_NAME = 'refresh-targets-weekly';

interface AnalystItem {
  firm?: string;
  target?: number | null;
  publishedAt?: string | null;
}

async function fetchAnalystReports(baseUrl: string, anonKey: string, code: string, name: string) {
  try {
    const res = await fetch(`${baseUrl}/functions/v1/checkup-analyst-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({ code, name, knownHashes: [], maxItems: 6, maxExtract: 3 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .filter((i: AnalystItem) => Number.isFinite(Number(i?.target)) && Number(i?.target) > 0 && (i?.firm || '').trim())
      .map((i: AnalystItem) => ({
        firm: String(i.firm || '').trim(),
        target: Number(i.target),
        date: i.publishedAt || null,
      }));
  } catch {
    return [];
  }
}

async function logRun(supabase: any, runId: string, stage: string, msg: string, payload: Record<string, unknown> = {}, level = 'info', extra: { user_id?: string | null } = {}) {
  try {
    await supabase.from('function_run_logs').insert({
      run_id: runId,
      fn: FN_NAME,
      stage,
      level,
      msg,
      payload: { ...payload, ...extra },
    });
  } catch (err) {
    console.error('logRun failed:', err);
  }
}

Deno.serve(withLogging('refresh-targets-weekly', async (req) => {
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

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = serviceClient();
  const runId = crypto.randomUUID();

  const stats = {
    runId,
    activeUsers: 0,
    holdingsScanned: 0,
    apiCalls: 0,
    inserted: 0,
    changedHoldings: 0,
    notifiedUsers: 0,
    errors: 0,
  };

  try {
    await logRun(supabase, runId, 'start', `開始每週目標價刷新`, { stats });

    // 1)) 找出 30 天內有登入的活躍用戶（auth.users.last_sign_in_at）
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: users, error: usersErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersErr) throw usersErr;
    const activeUsers = (users?.users || []).filter((u: any) => u?.last_sign_in_at && u.last_sign_in_at >= since);
    stats.activeUsers = activeUsers.length;
    await logRun(supabase, runId, 'users_loaded', `活躍用戶 ${activeUsers.length} 位`, { since });

    for (const user of activeUsers) {
      const userId = user.id;
      try {
        // 2) 讀該用戶持倉
        const { data: storage } = await supabase
          .from('checkup_storage')
          .select('data')
          .eq('user_id', userId)
          .eq('key', 'holdings-v2')
          .maybeSingle();
        const holdings = Array.isArray(storage?.data) ? storage.data : [];
        if (holdings.length === 0) continue;

        // 3) 取該用戶 (code, firm) 的最新目標價
        const codes = holdings.map((h: any) => String(h?.code || '').trim()).filter(Boolean);
        if (codes.length === 0) continue;
        stats.holdingsScanned += codes.length;

        const { data: latestRows } = await supabase
          .from('target_price_history')
          .select('code, firm, target, created_at')
          .eq('user_id', userId)
          .in('code', codes)
          .order('created_at', { ascending: false })
          .limit(2000);
        const latestByKey = new Map<string, number>();
        for (const row of latestRows || []) {
          const key = `${row.code}|${row.firm}`;
          if (!latestByKey.has(key)) latestByKey.set(key, Number(row.target));
        }

        const userChanges: { code: string; firm: string; from: number | null; to: number }[] = [];
        const insertRows: any[] = [];
        const batchId = crypto.randomUUID();

        for (const h of holdings) {
          const code = String(h?.code || '').trim();
          const name = String(h?.name || '').trim();
          if (!code) continue;
          stats.apiCalls += 1;
          const items = await fetchAnalystReports(supabaseUrl, anonKey, code, name);
          for (const it of items) {
            const key = `${code}|${it.firm}`;
            const prev = latestByKey.get(key);
            if (Number.isFinite(prev) && prev === it.target) continue;
            const changeType = Number.isFinite(prev) ? 'updated' : 'new';
            insertRows.push({
              user_id: userId, code, firm: it.firm, target: it.target,
              prev_target: Number.isFinite(prev) ? prev : null,
              report_date: it.date, change_type: changeType,
              source: 'weekly-cron', batch_id: batchId,
            });
            userChanges.push({ code, firm: it.firm, from: Number.isFinite(prev) ? Number(prev) : null, to: it.target });
            latestByKey.set(key, it.target);
          }
        }

        if (insertRows.length > 0) {
          // E-IDEM-002: 改 upsert，搭配唯一索引 uniq_tph_dedupe
          // (user_id, code, firm, report_date, target)，雙跑不會重複入庫
          const { error: insErr, data: upserted } = await supabase
            .from('target_price_history')
            .upsert(insertRows, { onConflict: 'user_id,code,firm,report_date,target', ignoreDuplicates: true })
            .select('id');
          if (insErr) throw insErr;
          const actuallyInserted = Array.isArray(upserted) ? upserted.length : insertRows.length;
          stats.inserted += actuallyInserted;
          stats.changedHoldings += new Set(userChanges.map(c => c.code)).size;

          // 4) 發送通知（依使用者偏好）
          const codesChanged = Array.from(new Set(userChanges.map(c => c.code)));
          const sample = userChanges.slice(0, 5).map(c => `${c.code} ${c.firm}: ${c.from ?? '—'} → ${c.to}`).join('\n');
          const { data: prefs } = await supabase
            .from('notification_preferences')
            .select('target_price_weekly')
            .eq('user_id', userId)
            .maybeSingle();
          const wantNotify = prefs?.target_price_weekly !== false;
          if (wantNotify) {
            await supabase.from('notifications').insert(buildNotificationRow({
              userId,
              title: `每週目標價更新：${codesChanged.length} 檔有異動`,
              body: `共 ${insertRows.length} 筆變動。\n${sample}${userChanges.length > 5 ? `\n…另 ${userChanges.length - 5} 筆` : ''}`,
              type: 'info',
              link: accountNotificationsUrl(),
            }));
            stats.notifiedUsers += 1;
          }

          await logRun(supabase, runId, 'user_done', `${userId} 異動 ${insertRows.length} 筆`, {
            inserted: insertRows.length, codes: codesChanged,
          }, 'info', { user_id: userId });
        }
      } catch (userErr) {
        stats.errors += 1;
        await logRun(supabase, runId, 'user_error', `處理使用者失敗`, {
          error: (userErr as Error).message,
        }, 'error', { user_id: userId });
      }
    }

    await logRun(supabase, runId, 'finish', `完成每週刷新`, { stats });
    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await logRun(supabase, runId, 'fatal', `致命錯誤`, { error: (err as Error).message, stats }, 'error');
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, stats }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
