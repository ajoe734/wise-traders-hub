/**
 * pipeline.ts — 每個階段用 in-memory fake PublishPort 獨立驗證。
 * 不碰 Supabase / LINE，只驗證階段契約：
 *   scope 解析、失敗續跑、只對成功者做副作用、sync 分支、訊息分組、推播分流。
 */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  resolveMarketScope, markSignalsPublished, syncTradeSignals,
  buildJournalMessages, groupByBatch, pushExpertJournals, runPublishPipeline,
} from './pipeline.ts';
import type { PendingSignal, PublishPort } from './port.ts';

const sig = (over: Partial<PendingSignal> = {}): PendingSignal => ({
  id: over.id ?? crypto.randomUUID(),
  expert_id: over.expert_id ?? 'e1',
  instrument: over.instrument ?? '2330 台積電',
  action: over.action ?? 'buy',
  price_hint: over.price_hint ?? 100,
  quantity: over.quantity ?? 1,
  quantity_unit: over.quantity_unit ?? '股',
  reason_summary: over.reason_summary ?? null,
  reason_detail: over.reason_detail ?? null,
  risk_notes: over.risk_notes ?? null,
  learning_points: over.learning_points ?? null,
  teaching_topic: over.teaching_topic ?? null,
  overall_summary: over.overall_summary ?? null,
  published_at: null,
  batch_id: 'batch_id' in over ? (over.batch_id ?? null) : 'b1',
  executed_at: null,
});

interface FakeState {
  experts: any[];
  pending: PendingSignal[];
  markFail: Map<string, any>;
  marked: Array<{ id: string; market: string }>;
  notifications: any[];
  unitLocks: any[];
  closed: string[];
  deletedPerf: string[];
  openedSignals: any[];
  openTradeRecords: Set<string>;
  openTradeSignals: Set<string>;
  channel: any;
  bindings: any[];
  subs: any[];
  planIds: string[];
  multicasts: Array<{ to: string[]; messages: any[] }>;
  multicastOk: boolean;
}

function fakePort(over: Partial<FakeState> = {}): { port: PublishPort; state: FakeState } {
  const state: FakeState = {
    experts: [{ id: 'e1', user_id: 'u1', name: '老周', slug: 'zhou', asset_class: 'tw_stock' }],
    pending: [], markFail: new Map(), marked: [], notifications: [], unitLocks: [],
    closed: [], deletedPerf: [], openedSignals: [],
    openTradeRecords: new Set(), openTradeSignals: new Set(),
    channel: { channel_access_token: 'tok', is_active: true },
    bindings: [], subs: [], planIds: ['p1'], multicasts: [], multicastOk: true,
    ...over,
  };
  const port: PublishPort = {
    listExperts: () => Promise.resolve(state.experts),
    listExpertsByIds: (ids) => Promise.resolve(state.experts.filter((e) => ids.includes(e.id))),
    getExpert: (id) => Promise.resolve(state.experts.find((e) => e.id === id) ?? null),
    listPendingSignals: (ids) =>
      Promise.resolve(ids ? state.pending.filter((s) => ids.includes(s.expert_id)) : state.pending),
    markSignalPublished: (id, market) => {
      const err = state.markFail.get(id);
      if (err) return Promise.reject(err);
      state.marked.push({ id, market });
      return Promise.resolve();
    },
    logUnitLockViolation: (p) => { state.unitLocks.push(p); return Promise.resolve(); },
    insertNotifications: (rows) => { state.notifications.push(...rows); return Promise.resolve(); },
    closeOpenTradeSignal: (u, s) => { state.closed.push(`${u}:${s}`); return Promise.resolve(); },
    deleteUserPerformance: (u, s) => { state.deletedPerf.push(`${u}:${s}`); return Promise.resolve(); },
    hasOpenTradeRecords: (_e, code) => Promise.resolve(state.openTradeRecords.has(code)),
    hasOpenTradeSignal: (_u, sym) => Promise.resolve(state.openTradeSignals.has(sym)),
    openTradeSignalWithPerformance: (a) => { state.openedSignals.push(a); return Promise.resolve(); },
    getLineChannel: () => Promise.resolve(state.channel),
    listActiveBindings: () => Promise.resolve(state.bindings),
    listActiveSubscriptions: () => Promise.resolve(state.subs),
    listExpertPlanIds: () => Promise.resolve(state.planIds),
    calcExpertPerformance: () => Promise.resolve({ win_rate: 60, avg_return: 5 }),
    sendLineMulticast: (_t, to, messages) => {
      state.multicasts.push({ to, messages });
      return Promise.resolve(state.multicastOk ? { ok: true, status: 200 } : { ok: false, status: 400, body: 'bad' });
    },
    now: () => new Date('2026-07-31T00:00:00Z'),
  };
  return { port, state };
}

// ── 1. scope ──────────────────────────────────────────────────────────────
Deno.test('resolveMarketScope: US 涵蓋 us_stock / us_futures / crypto，TW 取其餘', async () => {
  const { port } = fakePort({
    experts: [
      { id: 'a', asset_class: 'tw_stock' }, { id: 'b', asset_class: 'us_stock' },
      { id: 'c', asset_class: 'crypto' }, { id: 'd', asset_class: null },
      { id: 'e', asset_class: 'us_futures' },
    ],
  });
  assertEquals(await resolveMarketScope(port, 'US'), ['b', 'c', 'e']);
  assertEquals(await resolveMarketScope(port, 'TW'), ['a', 'd']);
});

// ── 2. mark published ─────────────────────────────────────────────────────
Deno.test('markSignalsPublished: 逐筆成功並依 instrument 帶入 market', async () => {
  const { port, state } = fakePort();
  const s1 = sig({ id: 's1', instrument: '2330 台積電' });
  const s2 = sig({ id: 's2', instrument: 'AAPL Apple' });
  const r = await markSignalsPublished(port, [s1, s2]);
  assertEquals(r.publishedIds, ['s1', 's2']);
  assertEquals(state.marked, [{ id: 's1', market: 'TW' }, { id: 's2', market: 'US' }]);
  assertEquals(r.failures.length, 0);
});

Deno.test('markSignalsPublished: 單筆失敗不中斷其餘，並通知導師', async () => {
  const { port, state } = fakePort({
    markFail: new Map([['s1', { code: 'P0001', message: 'CAPITAL_EXCEEDED: over cap' }]]),
  });
  const r = await markSignalsPublished(port, [sig({ id: 's1' }), sig({ id: 's2' })]);
  assertEquals(r.publishedIds, ['s2']);
  assertEquals(r.failures.length, 1);
  assertEquals(r.failures[0].kind, 'CAPITAL_EXCEEDED');
  assertEquals(r.publishedSignals.map((s) => s.id), ['s2']);
  assertEquals(state.notifications.length, 1);
  assertEquals(state.notifications[0].user_id, 'u1');
});

Deno.test('markSignalsPublished: transient 錯誤重試後成功會被記錄', async () => {
  const { port, state } = fakePort();
  let n = 0;
  const orig = port.markSignalPublished;
  port.markSignalPublished = (id, market) => {
    n++;
    if (n === 1) return Promise.reject({ code: '40001', message: 'deadlock detected' });
    return orig(id, market);
  };
  const r = await markSignalsPublished(port, [sig({ id: 's1' })]);
  assertEquals(r.publishedIds, ['s1']);
  assertEquals(r.retryStats.transientRecovered, 1);
  assert(r.retryStats.totalRetries >= 1);
  assertEquals(state.marked.length, 1);
});

// ── 3. sync ───────────────────────────────────────────────────────────────
Deno.test('syncTradeSignals: teaching / hold 不產生任何副作用', async () => {
  const { port, state } = fakePort();
  const r = await syncTradeSignals(port, [sig({ action: 'teaching' }), sig({ action: 'hold' })]);
  assertEquals(r, { syncOk: 2, syncFail: 0 });
  assertEquals(state.closed.length, 0);
  assertEquals(state.openedSignals.length, 0);
});

Deno.test('syncTradeSignals: exit 平倉；sell 僅在無剩餘持倉時平倉', async () => {
  const a = fakePort();
  await syncTradeSignals(a.port, [sig({ action: 'exit' })]);
  assertEquals(a.state.closed, ['u1:2330']);
  assertEquals(a.state.deletedPerf, ['u1:2330']);

  const b = fakePort({ openTradeRecords: new Set(['2330']) });
  await syncTradeSignals(b.port, [sig({ action: 'sell' })]);
  assertEquals(b.state.closed, []);

  const c = fakePort();
  await syncTradeSignals(c.port, [sig({ action: 'trim' })]);
  assertEquals(c.state.closed, ['u1:2330']);
});

Deno.test('syncTradeSignals: buy 只在沒有 open 訊號時建立', async () => {
  const a = fakePort();
  await syncTradeSignals(a.port, [sig({ action: 'buy', price_hint: 500 })]);
  assertEquals(a.state.openedSignals, [{ userId: 'u1', symbol: '2330', name: '台積電', entryPrice: 500 }]);

  const b = fakePort({ openTradeSignals: new Set(['2330']) });
  await syncTradeSignals(b.port, [sig({ action: 'add' })]);
  assertEquals(b.state.openedSignals, []);
});

Deno.test('syncTradeSignals: 單筆例外只算 syncFail，不中斷批次', async () => {
  const { port } = fakePort();
  port.closeOpenTradeSignal = () => Promise.reject(new Error('boom'));
  const r = await syncTradeSignals(port, [sig({ action: 'exit' }), sig({ action: 'hold' })]);
  assertEquals(r, { syncOk: 1, syncFail: 1 });
});

// ── 4. message building ───────────────────────────────────────────────────
Deno.test('groupByBatch: 同 batch 合併，無 batch_id 各自一組', () => {
  const groups = groupByBatch([
    sig({ id: 'a', batch_id: 'b1' }), sig({ id: 'b', batch_id: 'b1' }),
    sig({ id: 'c', batch_id: null }), sig({ id: 'd', batch_id: null }),
  ]);
  assertEquals(groups.map((g) => g.length), [2, 1, 1]);
});

Deno.test('buildJournalMessages: 超過 10 個 bubble 拆成多則 carousel', () => {
  const signals = Array.from({ length: 12 }, (_, i) => sig({ id: `s${i}`, batch_id: `b${i}` }));
  const msgs = buildJournalMessages('老周', signals);
  assertEquals(msgs.length, 2);
  assertEquals(msgs[0].contents.type, 'carousel');
  assertEquals(msgs[0].contents.contents.length, 10);
  assertEquals(msgs[1].contents.type, 'carousel');
  assertEquals(msgs[1].contents.contents.length, 2);
});

Deno.test('buildJournalMessages: 單一 bubble 直接當 flex contents', () => {
  const msgs = buildJournalMessages('老周', [sig()]);
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].contents.type, 'bubble');
  assert(String(msgs[0].altText).includes('老周'));
});

// ── 5. push ───────────────────────────────────────────────────────────────
Deno.test('pushExpertJournals: 沒有啟用頻道就完全不推播', async () => {
  const { port, state } = fakePort({ channel: { channel_access_token: 'tok', is_active: false } });
  const r = await pushExpertJournals(port, { expertId: 'e1', signals: [sig()], force: false });
  assertEquals(r.pushed, 0);
  assertEquals(state.multicasts.length, 0);
});

Deno.test('pushExpertJournals: 訂閱者收週記、已取消者收促購訊息', async () => {
  const { port, state } = fakePort({
    bindings: [
      { line_user_id: 'L1', user_id: 'm1' },
      { line_user_id: 'L2', user_id: 'm2' },
    ],
    subs: [
      { user_id: 'm1', plan_id: 'p1', canceled_at: null, expires_at: '2099-01-01T00:00:00Z' },
      { user_id: 'm2', plan_id: 'p1', canceled_at: '2026-07-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' },
    ],
  });
  const r = await pushExpertJournals(port, { expertId: 'e1', signals: [sig()], force: false });
  assertEquals(state.multicasts.length, 2);
  assertEquals(state.multicasts[0].to, ['L1']);
  assertEquals(state.multicasts[1].to, ['L2']);
  assertEquals(r.pushed, 2);
});

Deno.test('pushExpertJournals: force 時對訂閱者發站內提前開放通知（含 slug 深連結）', async () => {
  const { port, state } = fakePort({
    bindings: [{ line_user_id: 'L1', user_id: 'm1' }],
    subs: [{ user_id: 'm1', plan_id: 'p1', canceled_at: null, expires_at: '2099-01-01T00:00:00Z' }],
  });
  await pushExpertJournals(port, { expertId: 'e1', signals: [sig()], force: true });
  assertEquals(state.notifications.length, 1);
  assertEquals(state.notifications[0].link, '/app/expert/zhou');
  assertEquals(state.notifications[0].user_id, 'm1');
});

Deno.test('pushExpertJournals: multicast 失敗不計入 pushed', async () => {
  const { port } = fakePort({
    bindings: [{ line_user_id: 'L1', user_id: 'm1' }],
    subs: [{ user_id: 'm1', plan_id: 'p1', canceled_at: null, expires_at: '2099-01-01T00:00:00Z' }],
    multicastOk: false,
  });
  const r = await pushExpertJournals(port, { expertId: 'e1', signals: [sig()], force: false });
  assertEquals(r.pushed, 0);
});

// ── 6. orchestrator ───────────────────────────────────────────────────────
Deno.test('runPublishPipeline: 沒有 pending 時提早結束', async () => {
  const { port, state } = fakePort();
  const r = await runPublishPipeline(port, { filterExpertIds: null });
  assertEquals(r.published, 0);
  assertEquals(r.pushed, 0);
  assertEquals(state.marked.length, 0);
});

Deno.test('runPublishPipeline: 失敗的 signal 不進入 sync 與推播', async () => {
  const s1 = sig({ id: 's1', instrument: '2330 台積電', action: 'buy' });
  const s2 = sig({ id: 's2', instrument: '2603 長榮', action: 'buy' });
  const { port, state } = fakePort({
    pending: [s1, s2],
    markFail: new Map([['s1', { message: 'unit_conflict on 2330' }]]),
    bindings: [{ line_user_id: 'L1', user_id: 'm1' }],
    subs: [{ user_id: 'm1', plan_id: 'p1', canceled_at: null, expires_at: '2099-01-01T00:00:00Z' }],
  });
  const r = await runPublishPipeline(port, { filterExpertIds: null });

  assertEquals(r.published, 1);
  assertEquals(r.failed, 1);
  assertEquals(r.failures[0].kind, 'UNIT_CONFLICT');
  // 只有成功的 s2 建立部位
  assertEquals(state.openedSignals.map((o: any) => o.symbol), ['2603']);
  // 推播內容只包含 s2
  const flex = JSON.stringify(state.multicasts[0].messages);
  assert(flex.includes('2603'));
  assert(!flex.includes('2330'));
  assertEquals(r.pushed, 1);
});

Deno.test('runPublishPipeline: filterExpertIds 只處理指定老師', async () => {
  const { port } = fakePort({
    experts: [
      { id: 'e1', user_id: 'u1', name: 'A', slug: 'a' },
      { id: 'e2', user_id: 'u2', name: 'B', slug: 'b' },
    ],
    pending: [sig({ id: 's1', expert_id: 'e1' }), sig({ id: 's2', expert_id: 'e2' })],
  });
  const r = await runPublishPipeline(port, { filterExpertIds: ['e2'] });
  assertEquals(r.published, 1);
});

Deno.test('runPublishPipeline: 某位老師推播炸掉只計 pushFail', async () => {
  const { port } = fakePort({ pending: [sig({ id: 's1' })] });
  port.getLineChannel = () => Promise.reject(new Error('line down'));
  const r = await runPublishPipeline(port, { filterExpertIds: null });
  assertEquals(r.published, 1);
  assertEquals(r.pushFail, 1);
});
