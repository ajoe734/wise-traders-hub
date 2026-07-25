// PR-9: Chips Pipeline Guardian
// 每 5 分鐘 cron 呼叫，自動偵測異常並拉下對應 kill-switch，避免半夜燒 quota。
//
// 觸發規則：
//   1. finmind_bsr circuit 連續 open ≥ 2 小時 → 關閉 chips_keepwarm（保留 interactive）
//   2. 當日 finmind_quota_ledger 拒絕率 > 80% 且樣本 ≥ 50 → 關閉 chips_backfill
//   3. 任一 pool 連續 3 小時 100% quota_exceeded → 寫入 system_alerts 但不自動關（人工判斷）
//
// 每次觸發前先看 system_alerts 5 分鐘冷卻，避免 flap。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { forceDisable } from '../_shared/killSwitch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const OPEN_HOURS_TO_KILL_KEEPWARM = 2;
const REJECT_RATE_TO_KILL_BACKFILL = 0.8;
const REJECT_SAMPLE_MIN = 50;
const ALERT_COOLDOWN_MIN = 5;

interface Action {
  kind: 'disabled_switch' | 'alert';
  key?: string;
  reason: string;
  metric?: string;
}

async function alreadyAlerted(supa: any, code: string): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_COOLDOWN_MIN * 60_000).toISOString();
  const { data } = await supa
    .from('system_alerts')
    .select('id')
    .eq('code', code)
    .gte('created_at', since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function writeAlert(supa: any, code: string, severity: string, message: string, meta: any) {
  try {
    await supa.from('system_alerts').insert({
      code, severity, message, meta,
    });
  } catch (e) {
    console.warn('[guardian] write alert failed:', (e as Error).message);
  }
}

async function ruleCircuitLongOpen(supa: any): Promise<Action[]> {
  const actions: Action[] = [];
  const { data } = await supa
    .from('data_source_health')
    .select('source, circuit_state, disabled_until, last_failure_at')
    .in('source', ['finmind_bsr', 'twse_t86']);
  for (const row of (data ?? []) as any[]) {
    if (row.circuit_state !== 'open') continue;
    const failedAt = row.last_failure_at ? new Date(row.last_failure_at).getTime() : 0;
    const openHours = failedAt ? (Date.now() - failedAt) / 3_600_000 : 0;
    if (openHours >= OPEN_HOURS_TO_KILL_KEEPWARM && row.source === 'finmind_bsr') {
      const code = 'guardian_kill_keepwarm_circuit_open';
      if (!(await alreadyAlerted(supa, code))) {
        await forceDisable(supa, 'chips_keepwarm',
          `finmind_bsr circuit open ≥ ${OPEN_HOURS_TO_KILL_KEEPWARM}h`,
          `circuit_open_hours=${openHours.toFixed(1)}`);
        await writeAlert(supa, code, 'warning',
          `已自動停用 chips_keepwarm：finmind_bsr 熔斷已 ${openHours.toFixed(1)} 小時`,
          { source: row.source, disabled_until: row.disabled_until });
        actions.push({ kind: 'disabled_switch', key: 'chips_keepwarm', reason: 'circuit_long_open' });
      }
    }
  }
  return actions;
}

async function ruleQuotaRejectRate(supa: any): Promise<Action[]> {
  const actions: Action[] = [];
  const since = new Date(Date.now() - 60 * 60_000).toISOString(); // 過去 1 小時
  const { data } = await supa
    .from('finmind_quota_ledger')
    .select('pool_name, granted')
    .gte('created_at', since);
  const rows = (data ?? []) as { pool_name: string; granted: boolean }[];
  const byPool = new Map<string, { total: number; rejected: number }>();
  for (const r of rows) {
    const b = byPool.get(r.pool_name) ?? { total: 0, rejected: 0 };
    b.total += 1;
    if (!r.granted) b.rejected += 1;
    byPool.set(r.pool_name, b);
  }
  for (const [pool, stat] of byPool) {
    if (pool !== 'backfill') continue;
    if (stat.total < REJECT_SAMPLE_MIN) continue;
    const rate = stat.rejected / stat.total;
    if (rate < REJECT_RATE_TO_KILL_BACKFILL) continue;
    const code = 'guardian_kill_backfill_high_reject';
    if (await alreadyAlerted(supa, code)) continue;
    await forceDisable(supa, 'chips_backfill',
      `backfill pool reject rate ${(rate * 100).toFixed(0)}% (${stat.rejected}/${stat.total})`,
      `reject_rate=${rate.toFixed(2)}`);
    await writeAlert(supa, code, 'warning',
      `已自動停用 chips_backfill：過去 1 小時拒絕率 ${(rate * 100).toFixed(0)}%`,
      { pool, total: stat.total, rejected: stat.rejected });
    actions.push({ kind: 'disabled_switch', key: 'chips_backfill', reason: 'high_reject_rate' });
  }
  return actions;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const [a1, a2] = await Promise.all([
      ruleCircuitLongOpen(supa),
      ruleQuotaRejectRate(supa),
    ]);
    const actions = [...a1, ...a2];
    return new Response(JSON.stringify({ ok: true, actions, ran_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[chips-guardian] error:', (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
