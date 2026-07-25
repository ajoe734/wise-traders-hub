// PR-10: requestCoalescer Deno 單元測試
// 執行：deno test supabase/functions/_shared/requestCoalescer_test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { coalesce, inflightSize, setCoalesceObserver } from './requestCoalescer.ts';

Deno.test('coalesce: 同 key 併發只執行一次 factory', async () => {
  setCoalesceObserver(null);
  let calls = 0;
  const factory = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return 'X';
  };
  const [a, b, c] = await Promise.all([
    coalesce('k1', factory),
    coalesce('k1', factory),
    coalesce('k1', factory),
  ]);
  assertEquals(calls, 1);
  assertEquals([a, b, c], ['X', 'X', 'X']);
  assertEquals(inflightSize(), 0);
});

Deno.test('coalesce: 不同 key 各自執行', async () => {
  let calls = 0;
  const factory = async () => { calls++; return 'Y'; };
  await Promise.all([coalesce('a', factory), coalesce('b', factory)]);
  assertEquals(calls, 2);
});

Deno.test('coalesce: onAcquire 只在第一位觸發；onRelease 觸發於完成', async () => {
  let acq = 0, rel = 0;
  const factory = async () => { await new Promise((r) => setTimeout(r, 10)); return 1; };
  await Promise.all([
    coalesce('k2', factory, { onAcquire: () => { acq++; }, onRelease: () => { rel++; } }),
    coalesce('k2', factory, { onAcquire: () => { acq++; }, onRelease: () => { rel++; } }),
  ]);
  // 微 wait，讓 fire-and-forget release 完成
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(acq, 1, 'onAcquire 只跑一次');
  assertEquals(rel, 1, 'onRelease 只跑一次');
});

Deno.test('coalesce: onAcquire 拋錯不影響 factory', async () => {
  const factory = async () => 'ok';
  const val = await coalesce('k3', factory, {
    onAcquire: () => { throw new Error('boom'); },
  });
  assertEquals(val, 'ok');
});

Deno.test('coalesce: async onRelease 拋錯不影響回傳值', async () => {
  const factory = async () => 42;
  const val = await coalesce('k4', factory, {
    onRelease: async () => { throw new Error('boom-release'); },
  });
  assertEquals(val, 42);
});

Deno.test('coalesce: factory 拋錯時仍會呼 onRelease', async () => {
  let rel = 0;
  try {
    await coalesce('k5', async () => { throw new Error('fail'); }, {
      onRelease: () => { rel++; },
    });
    assert(false, 'should throw');
  } catch (e) {
    assertEquals((e as Error).message, 'fail');
  }
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(rel, 1);
});
