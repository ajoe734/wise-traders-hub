/**
 * publish-weekly-journals — partial-failure notification payload contract.
 *
 * The batch publisher continues past per-signal failures and writes a mentor
 * notification per failed signal. This test locks the exact `notifications`
 * row shape and per-error-kind copy so we cannot silently regress into:
 *   - swallowing failures (single failure aborting the whole run)
 *   - broken deep links (mentor cannot click through to the fix screen)
 *   - dropped signal_id (mentor cannot locate the failing draft)
 *   - lost error `kind` in aggregate logs (`failedByKind`)
 */
import {
  assertEquals,
  assertStringIncludes,
  assert,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  classifyPublishError,
  buildMentorFailureNotification,
  isTransientError,
  retryTransient,
  type PublishErrorInfo,
} from './classifyPublishError.ts';

const MENTOR_USER_ID = '11111111-2222-3333-4444-555555555555';
const SIGNAL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ── 1. classifyPublishError — kind × copy × link 對應表 ────────────────────
Deno.test('classify: CAPITAL_EXCEEDED via message', () => {
  const info = classifyPublishError({ message: 'CAPITAL_EXCEEDED: over cap' }, 'AAPL');
  assertEquals(info.kind, 'CAPITAL_EXCEEDED');
  assertEquals(info.link, '/admin/profile#capital');
  assertStringIncludes(info.title, 'AAPL');
  assertStringIncludes(info.title, '初始資金不足');
});

Deno.test('classify: CAPITAL_EXCEEDED via P0001 + capital keyword', () => {
  const info = classifyPublishError({ code: 'P0001', message: 'insufficient capital' }, '2330');
  assertEquals(info.kind, 'CAPITAL_EXCEEDED');
});

Deno.test('classify: INCOMPATIBLE_UNIT (美股寫「張」)', () => {
  const info = classifyPublishError(
    { message: 'incompatible_unit_for_asset_class: us_stock 張' },
    'TSLA',
  );
  assertEquals(info.kind, 'INCOMPATIBLE_UNIT');
  assertEquals(info.link, '/admin/signals');
  assertStringIncludes(info.body, '美股僅能用「股」');
});

Deno.test('classify: UNIT_CONFLICT via unit_conflict', () => {
  const info = classifyPublishError({ message: 'unit_conflict on 2330' }, '2330');
  assertEquals(info.kind, 'UNIT_CONFLICT');
});

Deno.test('classify: UNIT_CONFLICT via UNIT_MIX (export dialog symbol)', () => {
  const info = classifyPublishError({ details: 'UNIT_MIX detected' }, '2330');
  assertEquals(info.kind, 'UNIT_CONFLICT');
});

Deno.test('classify: UNKNOWN fallback keeps mentor unblocked', () => {
  const info = classifyPublishError({ message: 'random RLS boom' }, 'BTC');
  assertEquals(info.kind, 'UNKNOWN');
  assertEquals(info.link, '/admin/signals');
  assertStringIncludes(info.body, 'random RLS boom');
});

Deno.test('classify: UNKNOWN with no message still yields safe copy', () => {
  const info = classifyPublishError({}, '/ES');
  assertEquals(info.kind, 'UNKNOWN');
  assertStringIncludes(info.body, '未知原因');
  assertStringIncludes(info.title, '/ES');
});

// ── 2. buildMentorFailureNotification — payload contract ───────────────────
Deno.test('payload: shape locked to notifications table columns', () => {
  const info = classifyPublishError({ message: 'CAPITAL_EXCEEDED' }, 'AAPL');
  const row = buildMentorFailureNotification({
    mentorUserId: MENTOR_USER_ID,
    signalId: SIGNAL_ID,
    info,
  });
  // Must be exactly these 5 keys — extras would fail RLS / typegen
  assertEquals(
    Object.keys(row).sort(),
    ['body', 'link', 'title', 'type', 'user_id'].sort(),
  );
  assertEquals(row.user_id, MENTOR_USER_ID);
  assertEquals(row.type, 'error');
  assertEquals(row.title, info.title);
  assertEquals(row.link, info.link);
});

Deno.test('payload: body appends [Signal ID] for mentor traceability', () => {
  const info = classifyPublishError({ message: 'unit_conflict' }, '2330');
  const row = buildMentorFailureNotification({
    mentorUserId: MENTOR_USER_ID,
    signalId: SIGNAL_ID,
    info,
  });
  assertStringIncludes(row.body, info.body);
  assertStringIncludes(row.body, `[Signal ID] ${SIGNAL_ID}`);
  assert(row.body.endsWith(SIGNAL_ID), 'signal id must be at the tail');
});

Deno.test('payload: link is always relative /admin path (no absolute URL leak)', () => {
  const kinds: PublishErrorInfo[] = [
    classifyPublishError({ message: 'CAPITAL_EXCEEDED' }, 'X'),
    classifyPublishError({ message: 'incompatible_unit_for_asset_class' }, 'X'),
    classifyPublishError({ message: 'unit_conflict' }, 'X'),
    classifyPublishError({ message: 'boom' }, 'X'),
  ];
  for (const info of kinds) {
    assert(info.link.startsWith('/admin/'), `bad link: ${info.link}`);
    assert(!info.link.startsWith('http'), 'must be relative');
  }
});

// ── 3. Aggregate-level contract：模擬批次部分失敗 ───────────────────────────
Deno.test('batch: 3 混合失敗類型 → failedByKind 聚合正確', () => {
  const failures = [
    { instrument: 'AAPL', err: { message: 'CAPITAL_EXCEEDED' } },
    { instrument: 'TSLA', err: { message: 'incompatible_unit_for_asset_class' } },
    { instrument: 'AAPL', err: { message: 'unit_conflict' } },
    { instrument: 'BTC', err: { message: 'CAPITAL_EXCEEDED' } },
    { instrument: '/ES', err: { message: 'weird RLS' } },
  ];

  const classified = failures.map((f) => ({
    signal_id: crypto.randomUUID(),
    info: classifyPublishError(f.err, f.instrument),
  }));

  const failedByKind = classified.reduce(
    (acc: Record<string, number>, f) => {
      acc[f.info.kind] = (acc[f.info.kind] || 0) + 1;
      return acc;
    },
    {},
  );

  assertEquals(failedByKind.CAPITAL_EXCEEDED, 2);
  assertEquals(failedByKind.INCOMPATIBLE_UNIT, 1);
  assertEquals(failedByKind.UNIT_CONFLICT, 1);
  assertEquals(failedByKind.UNKNOWN, 1);

  // 每一筆都要能產出可寫入 notifications 的 payload
  for (const c of classified) {
    const row = buildMentorFailureNotification({
      mentorUserId: MENTOR_USER_ID,
      signalId: c.signal_id,
      info: c.info,
    });
    assertEquals(row.type, 'error');
    assertStringIncludes(row.body, c.signal_id);
  }
});

Deno.test('batch: 失敗的 signal 不會意外污染 publishedIds（模擬 filter 邏輯）', () => {
  const pending = [
    { id: 's1', instrument: 'AAPL' },
    { id: 's2', instrument: 'TSLA' },
    { id: 's3', instrument: '2330' },
  ];
  const failedIds = new Set(['s2']);
  const published = pending.filter((s) => !failedIds.has(s.id));
  assertEquals(published.map((s) => s.id), ['s1', 's3']);
});

// ── 4. 擴充錯誤分類：OVERSELL / SYMBOL_INVALID / TRANSIENT ─────────────────
Deno.test('classify: OVERSELL 賣出超過持倉', () => {
  const info = classifyPublishError({ message: 'OVERSELL: sell qty exceeds open position' }, '2330');
  assertEquals(info.kind, 'OVERSELL');
  assertEquals(info.retryable, false);
  assertStringIncludes(info.body, '賣出');
});

Deno.test('classify: SYMBOL_INVALID', () => {
  const info = classifyPublishError({ message: 'invalid_symbol: unknown_asset foo' }, 'FOO');
  assertEquals(info.kind, 'SYMBOL_INVALID');
  assertStringIncludes(info.body, '代碼');
});

Deno.test('classify: TRANSIENT via PG serialization_failure (40001)', () => {
  const info = classifyPublishError({ code: '40001', message: 'could not serialize access' }, 'AAPL');
  assertEquals(info.kind, 'TRANSIENT');
  assertEquals(info.retryable, true);
});

Deno.test('classify: TRANSIENT via deadlock_detected (40P01)', () => {
  const info = classifyPublishError({ code: '40P01', message: 'deadlock detected' }, 'AAPL');
  assertEquals(info.kind, 'TRANSIENT');
  assertEquals(info.retryable, true);
});

Deno.test('classify: TRANSIENT via fetch failure message', () => {
  const info = classifyPublishError({ message: 'fetch failed: ETIMEDOUT' }, 'AAPL');
  assertEquals(info.kind, 'TRANSIENT');
});

Deno.test('classify: non-transient P0001 CAPITAL_EXCEEDED stays non-retryable', () => {
  const info = classifyPublishError({ code: 'P0001', message: 'CAPITAL_EXCEEDED: over cap' }, 'AAPL');
  assertEquals(info.kind, 'CAPITAL_EXCEEDED');
  assertEquals(info.retryable, false);
});

Deno.test('isTransientError: recognizes lock_not_available / too_many_connections', () => {
  assert(isTransientError({ code: '55P03' }));
  assert(isTransientError({ code: '53300' }));
  assert(!isTransientError({ code: 'P0001', message: 'CAPITAL_EXCEEDED' }));
  assert(!isTransientError({ message: 'unit_conflict' }));
});

// ── 5. retryTransient：只重試 transient，非 transient 立即拋 ───────────────
Deno.test('retryTransient: 第 2 次成功 → attempts=2', async () => {
  let calls = 0;
  const { result, attempts } = await retryTransient(async () => {
    calls++;
    if (calls < 2) throw { code: '40P01', message: 'deadlock detected' };
    return 'ok';
  }, { baseDelayMs: 1 });
  assertEquals(result, 'ok');
  assertEquals(attempts, 2);
});

Deno.test('retryTransient: 非 transient 立即拋、不重試', async () => {
  let calls = 0;
  try {
    await retryTransient(async () => {
      calls++;
      throw { code: 'P0001', message: 'CAPITAL_EXCEEDED' };
    }, { baseDelayMs: 1 });
    assert(false, 'should have thrown');
  } catch (e: any) {
    assertEquals(e.code, 'P0001');
  }
  assertEquals(calls, 1);
});

Deno.test('retryTransient: 耗盡 maxAttempts 後拋最後一次錯誤', async () => {
  let calls = 0;
  try {
    await retryTransient(async () => {
      calls++;
      throw { code: '40001', message: `attempt ${calls}` };
    }, { maxAttempts: 3, baseDelayMs: 1 });
    assert(false);
  } catch (e: any) {
    assertEquals(e.message, 'attempt 3');
  }
  assertEquals(calls, 3);
});

Deno.test('retryTransient: onRetry 每次 transient 都會呼叫（不含最終拋出）', async () => {
  const retries: number[] = [];
  try {
    await retryTransient(async () => { throw { code: '40001', message: 'x' }; }, {
      maxAttempts: 3,
      baseDelayMs: 1,
      onRetry: (n) => retries.push(n),
    });
  } catch {/* ignore */}
  assertEquals(retries, [1, 2]);
});
