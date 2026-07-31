/**
 * chipsBackfillMachine — 純狀態機轉移測試（C3）。
 * 覆蓋原本散在 ChipsSection 4 個 useEffect 的所有分支。
 */
import { describe, it, expect } from 'vitest';
import {
  chipsBackfillReducer,
  initialChipsBackfillState,
  isBackfillSatisfied,
  shouldAutoTrigger,
  nextPollDelay,
  POLL_BACKOFF_MS,
  AUTO_BACKFILL_TIMEOUT_MS,
  type ChipsBackfillSnapshot,
  type ChipsBackfillState,
} from '@/checkup/lib/chipsBackfillMachine';

const T0 = 1_700_000_000_000;

function snap(over: Partial<ChipsBackfillSnapshot> = {}): ChipsBackfillSnapshot {
  return {
    stockCode: '2330',
    hasData: true,
    sparse: true,
    eligible: true,
    syncStatus: 'idle',
    satisfied: false,
    now: T0,
    ...over,
  };
}

function step(state: ChipsBackfillState, ...events: Parameters<typeof chipsBackfillReducer>[1][]) {
  let cur = state;
  let effects: ReturnType<typeof chipsBackfillReducer>['effects'] = [];
  for (const e of events) {
    const r = chipsBackfillReducer(cur, e);
    cur = r.state;
    effects = r.effects;
  }
  return { state: cur, effects };
}

describe('chipsBackfillMachine', () => {
  it('稀疏資料首次觀測會觸發回補並進入 triggered', () => {
    const r = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    expect(r.state.phase).toBe('triggered');
    expect(r.state.startedAt).toBe(T0);
    expect(r.effects).toEqual([{ type: 'requestBackfill', stockCode: '2330' }]);
  });

  it('同一檔股票只自動觸發一次（重複 snapshot 不重排）', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    const b = chipsBackfillReducer(a.state, { type: 'snapshot', snapshot: snap({ now: T0 + 5000 }) });
    expect(b.effects).toEqual([]);
    expect(b.state.phase).toBe('triggered');
  });

  it('換股後回到 idle，但 fired 記憶保留 → 切回原股不重排', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    const b = chipsBackfillReducer(a.state, { type: 'stock', stockCode: '2454' });
    expect(b.state.phase).toBe('idle');
    expect(b.state.fired).toContain('2330');

    const c = chipsBackfillReducer(b.state, { type: 'stock', stockCode: '2330' });
    const d = chipsBackfillReducer(c.state, { type: 'snapshot', snapshot: snap() });
    expect(d.effects).toEqual([]);
    expect(d.state.phase).toBe('idle');
  });

  it('換股後新股票仍會各自觸發一次', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    const b = chipsBackfillReducer(a.state, { type: 'stock', stockCode: '2454' });
    const c = chipsBackfillReducer(b.state, { type: 'snapshot', snapshot: snap({ stockCode: '2454' }) });
    expect(c.effects).toEqual([{ type: 'requestBackfill', stockCode: '2454' }]);
    expect(c.state.fired).toEqual(['2330', '2454']);
  });

  it.each([
    ['資料未到手', { hasData: false }],
    ['資料不稀疏', { sparse: false }],
    ['後端判定不可同步', { eligible: false as const }],
    ['後端 pending 中', { syncStatus: 'pending' }],
    ['後端 running 中', { syncStatus: 'running' }],
  ])('不觸發：%s', (_label, over) => {
    const r = chipsBackfillReducer(initialChipsBackfillState, {
      type: 'snapshot',
      snapshot: snap(over as Partial<ChipsBackfillSnapshot>),
    });
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe('idle');
  });

  it('補滿後由 triggered 收斂為 ready', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    const b = chipsBackfillReducer(a.state, {
      type: 'snapshot',
      snapshot: snap({ satisfied: true, sparse: false, now: T0 + 60_000 }),
    });
    expect(b.state.phase).toBe('ready');
    expect(b.effects).toEqual([]);
  });

  it('逾時進入 timeout 並送出 elapsed 追蹤事件', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    const b = chipsBackfillReducer(a.state, {
      type: 'timeout',
      stockCode: '2330',
      now: T0 + AUTO_BACKFILL_TIMEOUT_MS,
    });
    expect(b.state.phase).toBe('timeout');
    expect(b.effects).toEqual([
      { type: 'trackTimeout', stockCode: '2330', elapsedMs: AUTO_BACKFILL_TIMEOUT_MS },
    ]);
  });

  it('已 ready 後的逾時事件不再回報（避免誤報）', () => {
    const { state } = step(
      initialChipsBackfillState,
      { type: 'snapshot', snapshot: snap() },
      { type: 'snapshot', snapshot: snap({ satisfied: true }) },
    );
    const r = chipsBackfillReducer(state, { type: 'timeout', stockCode: '2330', now: T0 + 1 });
    expect(r.state.phase).toBe('ready');
    expect(r.effects).toEqual([]);
  });

  it('換股後殘留的逾時事件被忽略', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'snapshot', snapshot: snap() });
    const b = chipsBackfillReducer(a.state, { type: 'stock', stockCode: '2454' });
    const c = chipsBackfillReducer(b.state, { type: 'timeout', stockCode: '2330', now: T0 + 1 });
    expect(c.state.phase).toBe('idle');
    expect(c.effects).toEqual([]);
  });

  it('換股後殘留的 snapshot（他股）被忽略', () => {
    const a = chipsBackfillReducer(initialChipsBackfillState, { type: 'stock', stockCode: '2454' });
    const b = chipsBackfillReducer(a.state, { type: 'snapshot', snapshot: snap({ stockCode: '2330' }) });
    expect(b.effects).toEqual([]);
  });

  it('timeout 後若資料補齊也不會退回 ready（終態）', () => {
    const { state } = step(
      initialChipsBackfillState,
      { type: 'snapshot', snapshot: snap() },
      { type: 'timeout', stockCode: '2330', now: T0 + AUTO_BACKFILL_TIMEOUT_MS },
    );
    const r = chipsBackfillReducer(state, { type: 'snapshot', snapshot: snap({ satisfied: true }) });
    expect(r.state.phase).toBe('timeout');
  });

  it('shouldAutoTrigger 與 reducer 判斷一致', () => {
    expect(shouldAutoTrigger(initialChipsBackfillState, snap())).toBe(true);
    expect(shouldAutoTrigger(initialChipsBackfillState, snap({ eligible: false }))).toBe(false);
  });
});

describe('isBackfillSatisfied', () => {
  it.each([
    [{ readiness60: 'ready' }, true],
    [{ readiness20: 'ready' }, true],
    [{ instDays: 20 }, true],
    [{ instDays: 19 }, false],
    [{ readiness60: 'filling', readiness20: 'filling', instDays: 3 }, false],
    [{}, false],
  ])('%o → %s', (input, expected) => {
    expect(isBackfillSatisfied(input as never)).toBe(expected);
  });
});

describe('nextPollDelay', () => {
  it('依序退避並在最大值封頂', () => {
    expect(POLL_BACKOFF_MS.map((_, i) => nextPollDelay(i))).toEqual([...POLL_BACKOFF_MS]);
    expect(nextPollDelay(99)).toBe(POLL_BACKOFF_MS[POLL_BACKOFF_MS.length - 1]);
    expect(nextPollDelay(-1)).toBe(POLL_BACKOFF_MS[0]);
  });
});
