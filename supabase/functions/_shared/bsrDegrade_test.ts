// deno test --allow-env --allow-read --no-check supabase/functions/_shared/bsrDegrade_test.ts
//
// 純邏輯測試：狀態機轉移、cooldown、逐級恢復、policy caps。
// 併發測試：即使降級到 p1_only / claim_halt，實際 fetch 仍嚴格走原子 reservation，
// 且不會超過 hourly limit。此處以 in-memory mock 模擬 reservation 與 fetch，避免依賴 DB / FinMind。

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  decide,
  desiredMode,
  effectiveMaxPriority,
  policyOf,
  stepDownTarget,
  DEFAULT_COOLDOWN_SEC,
  EMERGENCY_COOLDOWN_SEC,
  type DegradeState,
  type Signals,
} from './bsrDegrade.ts';

const emptySignals = (): Signals => ({
  usagePct: 0,
  rateLimited429Streak: 0,
  p1OldestPendingAgeSec: 0,
  reservationExpiredUnsettled: 0,
  reservationOldestInFlightSec: 0,
});

const stateAt = (mode: any, sinceMs: number, cooldownUntilMs: number): DegradeState => ({
  mode, since: sinceMs, cooldownUntil: cooldownUntilMs,
});

// ============ 期望模式（僅看訊號） ============
Deno.test('desiredMode: healthy → normal', () => {
  assertEquals(desiredMode(emptySignals()).mode, 'normal');
});

Deno.test('desiredMode: usage ≥80% → tier3_paused', () => {
  const s = { ...emptySignals(), usagePct: 82 };
  assertEquals(desiredMode(s).mode, 'tier3_paused');
});

Deno.test('desiredMode: usage ≥90% 優先於 80%', () => {
  const s = { ...emptySignals(), usagePct: 92 };
  assertEquals(desiredMode(s).mode, 'tier2_paused');
});

Deno.test('desiredMode: 429 連續 ≥3 分鐘 → tier2_paused', () => {
  const s = { ...emptySignals(), rateLimited429Streak: 4 };
  assertEquals(desiredMode(s).mode, 'tier2_paused');
});

Deno.test('desiredMode: P1 pending ≥30 分 → tier3_paused', () => {
  const s = { ...emptySignals(), p1OldestPendingAgeSec: 2000 };
  assertEquals(desiredMode(s).mode, 'tier3_paused');
});

Deno.test('desiredMode: reservation stuck 優先於一切 → claim_halt', () => {
  const s = { ...emptySignals(), usagePct: 95, reservationExpiredUnsettled: 10 };
  assertEquals(desiredMode(s).mode, 'claim_halt');
  const s2 = { ...emptySignals(), reservationOldestInFlightSec: 400 };
  assertEquals(desiredMode(s2).mode, 'claim_halt');
});

// ============ 升級：無視 cooldown ============
Deno.test('decide: 升級忽略 cooldown（normal → tier3_paused）', () => {
  const now = 100_000_000;
  // 明明還在 cooldown 期間也要升級
  const cur = stateAt('normal', now - 1000, now + 999_999);
  const d = decide(cur, { ...emptySignals(), usagePct: 85 }, now);
  assertEquals(d.shouldTransition, true);
  assertEquals(d.targetMode, 'tier3_paused');
  assertEquals(d.cooldownSeconds, DEFAULT_COOLDOWN_SEC);
});

Deno.test('decide: claim_halt 使用短 cooldown', () => {
  const now = 1;
  const d = decide(stateAt('normal', 0, 0), { ...emptySignals(), reservationExpiredUnsettled: 10 }, now);
  assertEquals(d.targetMode, 'claim_halt');
  assertEquals(d.cooldownSeconds, EMERGENCY_COOLDOWN_SEC);
});

// ============ 降級：cooldown / 逐級 / 條件 ============
Deno.test('decide: cooldown 未到 → 不降級', () => {
  const now = 500;
  const cur = stateAt('tier3_paused', 0, now + 1000);
  const d = decide(cur, emptySignals(), now);
  assertEquals(d.shouldTransition, false);
  assertEquals(d.targetMode, 'tier3_paused');
  assertEquals(d.reason, 'cooldown_active');
});

Deno.test('decide: cooldown 到期 + 條件符合 → 逐級降一階', () => {
  const now = 10_000;
  const cur = stateAt('tier2_paused', 0, now - 1);
  // 用量 70、無 429 → 只能退到 tier3_paused，不會一次跳回 normal
  const d = decide(cur, { ...emptySignals(), usagePct: 70 }, now);
  assertEquals(d.shouldTransition, true);
  assertEquals(d.targetMode, 'tier3_paused');
});

Deno.test('decide: 逐級恢復條件不滿足 → 不動', () => {
  const now = 10_000;
  const cur = stateAt('tier2_paused', 0, now - 1);
  const d = decide(cur, { ...emptySignals(), usagePct: 88 }, now);
  assertEquals(d.shouldTransition, false);
  assertEquals(d.reason, 'step_down_conditions_not_met');
});

Deno.test('decide: 從 claim_halt 只能退到 p1_only 且需要 reservation 清空', () => {
  const now = 10_000;
  const cur = stateAt('claim_halt', 0, now - 1);
  // reservation 未清 → 不動
  let d = decide(cur, { ...emptySignals(), reservationExpiredUnsettled: 2 }, now);
  assertEquals(d.shouldTransition, false);
  // reservation 清了 → 退到 p1_only
  d = decide(cur, emptySignals(), now);
  assertEquals(d.shouldTransition, true);
  assertEquals(d.targetMode, 'p1_only');
});

Deno.test('decide: 一路健康時，每個 cooldown 只退一階，避免震盪', () => {
  const now0 = 0;
  const cooldownMs = DEFAULT_COOLDOWN_SEC * 1000;
  let state = stateAt('claim_halt', now0, now0 - 1);
  const sig = emptySignals();
  const path: string[] = [state.mode];
  // 模擬跑 6 次「cooldown 到期後再評估」
  let now = now0;
  for (let i = 0; i < 6; i++) {
    const d = decide(state, sig, now);
    if (d.shouldTransition) {
      state = stateAt(d.targetMode, now, now + cooldownMs);
      path.push(d.targetMode);
    }
    now += cooldownMs + 1;
  }
  // 從 claim_halt 一路退到 normal，經歷 4 個中間步驟
  assertEquals(path, ['claim_halt', 'p1_only', 'tier2_paused', 'tier3_paused', 'normal']);
});

// ============ Policy caps ============
Deno.test('policyOf: 各模式的 max_priority / concurrency 對應', () => {
  assertEquals(policyOf('normal').maxPriority, 3);
  assertEquals(policyOf('tier3_paused').maxPriority, 2);
  assertEquals(policyOf('tier2_paused').maxPriority, 1);
  assertEquals(policyOf('p1_only').concurrency, 1);
  assertEquals(policyOf('claim_halt').allowClaim, false);
});

Deno.test('effectiveMaxPriority: 外部請求會被 policy cap', () => {
  assertEquals(effectiveMaxPriority('tier3_paused', 3), 2);
  assertEquals(effectiveMaxPriority('p1_only', 3), 1);
  assertEquals(effectiveMaxPriority('normal', 2), 2);
});

Deno.test('stepDownTarget: 只回下一階', () => {
  assertEquals(stepDownTarget('claim_halt', emptySignals()).next, 'p1_only');
  assertEquals(stepDownTarget('normal', emptySignals()).ok, false);
});

// ============ 併發：降級不影響 reservation 原子性 ============
//
// 模擬：hourly limit = 5、當前用量 4（滑動視窗），policy = p1_only（concurrency=1）。
// 送 100 個 job；worker 依 policy 限制併發；每個 job 需先 reserveQuota 才能 fetch。
// 斷言：實際 fetch 次數 = min(可用配額 = 1, 100) = 1。
Deno.test('併發：p1_only 併發=1、剩 1 額度 → 只發 1 個 fetch，不會超額', async () => {
  const HOURLY = 5;
  let usedInWindow = 4;
  let inFlight = 0;
  let peakInFlight = 0;
  let actualFetches = 0;

  // in-memory 原子 reservation
  const mu = { locked: false };
  async function reserve(): Promise<number | null> {
    // 模擬 advisory lock：非同步序列化
    while (mu.locked) await new Promise((r) => setTimeout(r, 0));
    mu.locked = true;
    try {
      if (usedInWindow + inFlight >= HOURLY) return null;
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return Date.now();
    } finally {
      mu.locked = false;
    }
  }
  async function settle(_id: number, success: boolean) {
    inFlight--;
    if (success) usedInWindow++;
  }
  async function fetchMock() {
    actualFetches++;
    await new Promise((r) => setTimeout(r, 1));
    return { ok: true };
  }

  // p1_only：concurrency = 1
  const policy = policyOf('p1_only');
  const jobs = Array.from({ length: 100 }, (_, i) => i);
  let idx = 0;

  async function worker() {
    while (idx < jobs.length) {
      const my = idx++;
      const id = await reserve();
      if (id === null) continue; // 超額直接跳過
      try {
        const r = await fetchMock();
        await settle(id, r.ok);
      } catch {
        await settle(id, false);
      }
    }
  }
  await Promise.all(Array.from({ length: policy.concurrency }, worker));

  assertEquals(actualFetches, 1, `應只有 1 次 fetch，實際=${actualFetches}`);
  assertEquals(usedInWindow, 5, '結算後用量應正好觸頂 5/5');
  assert(peakInFlight <= 1, 'p1_only 併發不得超過 1');
});

// 高併發 + tier2_paused：模擬 2000 job、限額剛好 10、concurrency=2 → 只發 10 個
Deno.test('併發：tier2_paused 高併發 2000 job、剩 10 額度 → 只發 10 個', async () => {
  const HOURLY = 1500;
  let usedInWindow = 1490; // 剩 10
  let inFlight = 0;
  let actualFetches = 0;

  const mu = { locked: false };
  async function reserve() {
    while (mu.locked) await new Promise((r) => setTimeout(r, 0));
    mu.locked = true;
    try {
      if (usedInWindow + inFlight >= HOURLY) return null;
      inFlight++;
      return true;
    } finally { mu.locked = false; }
  }
  async function settle(success: boolean) {
    inFlight--;
    if (success) usedInWindow++;
  }
  async function fetchMock() {
    actualFetches++;
    await new Promise((r) => setTimeout(r, 1));
    return { ok: true };
  }

  const policy = policyOf('tier2_paused');
  const N = 2000;
  let idx = 0;
  async function w() {
    while (idx < N) {
      idx++;
      const ok = await reserve();
      if (!ok) continue;
      const r = await fetchMock();
      await settle(r.ok);
    }
  }
  await Promise.all(Array.from({ length: policy.concurrency }, w));

  assertEquals(actualFetches, 10, `應正好 10 次 fetch，實際=${actualFetches}`);
  assertEquals(usedInWindow, 1500);
});

// P1 不會被 P2/P3 擠壓：worker 只 claim ≤ maxPriority 的 job
Deno.test('P1 不被擠壓：p1_only 模式下 claim 只允許 priority=1', () => {
  const cap = effectiveMaxPriority('p1_only', 3);
  assertEquals(cap, 1);
  // 模擬 claim RPC：正確做法是把此 cap 傳入 SQL 的 max_priority
  const jobs = [
    { id: 1, priority: 3 },
    { id: 2, priority: 2 },
    { id: 3, priority: 1 },
    { id: 4, priority: 1 },
  ];
  const claimed = jobs.filter((j) => j.priority <= cap);
  assertEquals(claimed.map((j) => j.id), [3, 4]);
});
