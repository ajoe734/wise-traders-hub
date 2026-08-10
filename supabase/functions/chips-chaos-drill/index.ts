// AUTH: cron  (亦接受 company_admin JWT；手動演練用)
// 壅塞演練（chaos drill）：手動觸發，用固定假資料重現三種壅塞情境，
// 跑「真正的」auto-heal 副作用，再斷言每次都恢復到 normal，
// 且 reset_at / daily_budget 有被更新。
//
// 只作用在 drill_ 前綴的沙箱物件：
//   - system_kill_switches.key = drill_chaos_switch
//   - tw_bsr_sync_config.key   = degrade:drill_chaos
//   - finmind_quota_pools      = drill_chaos_pool
// 正式 pipeline 不會讀到它們；chips-guardian 也已排除 drill_ 池。
//
// 呼叫方式（staging）：
//   POST /functions/v1/chips-chaos-drill
//   body: { "scenarios": ["kill_switch","degrade","quota_pool"], "cleanup": true }
// 需要 X-Cron-Key，或帶 company_admin 的 Authorization JWT。

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';

import { healSwitches, healDegrade, healQuotaPools, readDegradeConfig, type HealDeps } from '../_shared/autoHealEffects.ts';
import {
  DRILL_SCENARIOS,
  DRILL_SWITCH_KEY,
  DRILL_POOL_NAME,
  DRILL_DEGRADE_API,
  buildSwitchFixture,
  buildDegradeFixture,
  buildPoolStaleFixture,
  buildPoolExhaustedFixture,
  verifySwitch,
  verifyDegrade,
  verifyPoolRollOver,
  verifyPoolRestoreBudget,
  allPassed,
  type Check,
  type DrillScenario,
  type ScenarioResult,
} from '../_shared/chaosDrillScenarios.ts';
import { MODE_ORDER } from '../_shared/bsrDegrade.ts';

/** 演練不寫 system_alerts，避免污染正式告警；只記在回傳的 log 裡。 */
function drillDeps(supa: any, nowMs: number, log: string[]): HealDeps {
  return {
    supa,
    nowMs,
    writeAlert: async (code, _severity, message) => { log.push(`${code}: ${message}`); },
    fetchPoolSamples: async () => 0, // 沙箱無流量 → 觸發 traffic_starved / force reopen 路徑
  };
}

async function runKillSwitch(supa: any, nowMs: number): Promise<ScenarioResult> {
  const log: string[] = [];
  const fixture = buildSwitchFixture(nowMs);
  await supa.from('system_kill_switches').upsert(fixture, { onConflict: 'key' });
  const before = (await supa.from('system_kill_switches')
    .select('key, enabled, disabled_reason, disabled_at').eq('key', DRILL_SWITCH_KEY).maybeSingle()).data;

  const actions = await healSwitches(drillDeps(supa, nowMs, log), {
    keys: [DRILL_SWITCH_KEY],
    switchToPool: {},
  });

  const after = (await supa.from('system_kill_switches')
    .select('key, enabled, disabled_reason, disabled_at').eq('key', DRILL_SWITCH_KEY).maybeSingle()).data;
  const checks = verifySwitch(after);
  return {
    scenario: 'kill_switch',
    passed: allPassed(checks),
    checks,
    before: before ?? {},
    after: after ?? {},
    actions: actions.map((a) => a.reason).concat(log),
  };
}

async function runDegrade(supa: any, nowMs: number): Promise<ScenarioResult> {
  const log: string[] = [];
  const key = `degrade:${DRILL_DEGRADE_API}`;
  const fixture = buildDegradeFixture(nowMs);
  await supa.from('tw_bsr_sync_config').upsert(
    { key, config: fixture, note: 'chaos-drill' },
    { onConflict: 'key' },
  );
  const before = await readDegradeConfig(supa, DRILL_DEGRADE_API);

  // 逐級退回：每步之間把 cooldown_until / last_transition_at 往回撥，
  // 模擬「冷卻期已過、卡了很久」，驗證最終一定收斂到 normal。
  const steps: string[] = [];
  const actions: string[] = [];
  for (let i = 0; i < MODE_ORDER.length + 1; i++) {
    const cfg = await readDegradeConfig(supa, DRILL_DEGRADE_API);
    if (String(cfg.mode ?? 'normal') === 'normal') break;
    const acts = await healDegrade(drillDeps(supa, nowMs, log), {
      api: DRILL_DEGRADE_API,
      hasActiveDegradeSignal: false,
    });
    if (acts.length === 0) break;
    actions.push(...acts.map((a) => a.reason));
    const next = await readDegradeConfig(supa, DRILL_DEGRADE_API);
    steps.push(String(next.mode));
    if (String(next.mode) === 'normal') break;
    // RPC 會寫入 +300s cooldown 與最新 last_transition_at；撥回過去讓下一級可以繼續。
    await supa.from('tw_bsr_sync_config').update({
      config: {
        ...next,
        cooldown_until: new Date(nowMs - 30 * 60_000).toISOString(),
        last_transition_at: new Date(nowMs - 90 * 60_000).toISOString(),
      },
    }).eq('key', key);
  }

  const after = await readDegradeConfig(supa, DRILL_DEGRADE_API);
  const checks = verifyDegrade(after, steps);
  return {
    scenario: 'degrade',
    passed: allPassed(checks),
    checks,
    before,
    after,
    actions: actions.concat(log).concat(`steps=${steps.join('->') || 'none'}`),
  };
}

const POOL_COLS = 'pool_name, daily_budget, base_daily_budget, used_today, reset_at, tokens, capacity, manual_override';

async function runQuotaPool(supa: any, nowMs: number): Promise<ScenarioResult> {
  const log: string[] = [];
  const actions: string[] = [];

  // A. 跨日未 reset（reset_at 停在昨天）+ 預算被收緊
  await supa.from('finmind_quota_pools').upsert(buildPoolStaleFixture(nowMs), { onConflict: 'pool_name' });
  const before = (await supa.from('finmind_quota_pools').select(POOL_COLS).eq('pool_name', DRILL_POOL_NAME).maybeSingle()).data;
  const a1 = await healQuotaPools(drillDeps(supa, nowMs, log), { poolNames: [DRILL_POOL_NAME] });
  actions.push(...a1.map((a) => a.reason));
  const afterRollOver = (await supa.from('finmind_quota_pools').select(POOL_COLS).eq('pool_name', DRILL_POOL_NAME).maybeSingle()).data;
  const checksA = verifyPoolRollOver(afterRollOver, nowMs);

  // B. 當日已用滿且預算低於 base
  await supa.from('finmind_quota_pools').upsert(buildPoolExhaustedFixture(nowMs), { onConflict: 'pool_name' });
  const a2 = await healQuotaPools(drillDeps(supa, nowMs, log), { poolNames: [DRILL_POOL_NAME] });
  actions.push(...a2.map((a) => a.reason));
  const afterRestore = (await supa.from('finmind_quota_pools').select(POOL_COLS).eq('pool_name', DRILL_POOL_NAME).maybeSingle()).data;
  const checksB = verifyPoolRestoreBudget(afterRestore);

  const checks: Check[] = [
    ...checksA.map((c) => ({ ...c, name: `A(跨日) ${c.name}` })),
    ...checksB.map((c) => ({ ...c, name: `B(用滿) ${c.name}` })),
  ];
  return {
    scenario: 'quota_pool',
    passed: allPassed(checks),
    checks,
    before: before ?? {},
    after: { roll_over: afterRollOver ?? {}, restore_budget: afterRestore ?? {} },
    actions: actions.concat(log),
  };
}

async function cleanupDrill(supa: any): Promise<void> {
  await supa.from('system_kill_switches').delete().eq('key', DRILL_SWITCH_KEY);
  await supa.from('tw_bsr_sync_config').delete().eq('key', `degrade:${DRILL_DEGRADE_API}`);
  await supa.from('finmind_quota_pools').delete().eq('pool_name', DRILL_POOL_NAME);
  await supa.from('tw_bsr_degrade_events').delete().eq('api_name', DRILL_DEGRADE_API);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // AUTH: cron key（自動化）或 company_admin JWT（後台手動按鈕）
  // 管理員判定一律走 _shared/adminGuard，禁止在此手刻 has_role（見 audit-admin-contract）。
  try {
    if (req.headers.get('x-cron-key')) {
      requireCronKey(req);
    } else {
      await requireCompanyAdmin(req);
    }
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, req);
    throw e;
  }


  const supa = serviceClient();
  const startedAt = new Date().toISOString();
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const requested: DrillScenario[] = Array.isArray(body.scenarios) && body.scenarios.length
      ? body.scenarios.filter((s: string) => (DRILL_SCENARIOS as readonly string[]).includes(s))
      : [...DRILL_SCENARIOS];
    const cleanup = body.cleanup !== false;
    const nowMs = Date.now();

    // 每次演練都從乾淨狀態開始，避免上一輪殘留影響結果。
    await cleanupDrill(supa);

    const results: ScenarioResult[] = [];
    for (const s of requested) {
      if (s === 'kill_switch') results.push(await runKillSwitch(supa, nowMs));
      else if (s === 'degrade') results.push(await runDegrade(supa, nowMs));
      else if (s === 'quota_pool') results.push(await runQuotaPool(supa, nowMs));
    }

    if (cleanup) await cleanupDrill(supa);

    const passed = results.every((r) => r.passed);
    const summary = results.map((r) => `${r.scenario}=${r.passed ? 'PASS' : 'FAIL'}`).join(' ');
    console.log(`[chaos-drill] ${summary}`);

    return new Response(JSON.stringify({
      ok: true,
      passed,
      summary,
      cleaned_up: cleanup,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results,
    }), { status: passed ? 200 : 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[chaos-drill] error:', (e as Error).message);
    try { await cleanupDrill(supa); } catch { /* best effort */ }
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
