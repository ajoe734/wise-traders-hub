/**
 * Source contract · `__reset*ForTests()` 必須是 DEV/test-only。
 *
 * 背景：Stage2 plan 承諾兩支 reset 只在 DEV/test 生效，但 source 曾是無 guard export，
 * 等於 production bundle 也能被任意呼叫清掉 singleton timer 與 reservation。
 * 這支 contract test 同時鎖住「守衛存在」與「vitest 下仍可用」兩件事。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  __TEST_ONLY_ENABLED as STORE_GUARD,
  __resetExpectedStoreForTests,
  __storeDebugState,
} from '@/checkup/lib/expectedTradeDateStore';
import {
  __TEST_ONLY_ENABLED as TASK_GUARD,
  __resetSparklineTaskForTests,
  __taskDebugState,
} from '@/checkup/lib/sparklineFetchTask';

const FILES = [
  'src/checkup/lib/expectedTradeDateStore.ts',
  'src/checkup/lib/sparklineFetchTask.ts',
];

describe('test-only reset guard', () => {
  it.each(FILES)('%s 的 reset 有 production no-op guard', (rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    expect(src).toContain('__TEST_ONLY_ENABLED');
    expect(src).toMatch(/if \(!__TEST_ONLY_ENABLED\) return;/);
    // 守衛必須寫在 reset 函式的第一行，不能只是宣告了常數卻沒用
    const body = src.slice(src.indexOf('export function __reset'));
    expect(body.split('\n')[1].trim()).toMatch(/^if \(!__TEST_ONLY_ENABLED\) return;/);
  });

  it('vitest 環境下 guard 為 true，unit harness reset 仍可運作', () => {
    expect(STORE_GUARD).toBe(true);
    expect(TASK_GUARD).toBe(true);
    __resetExpectedStoreForTests();
    __resetSparklineTaskForTests();
    expect(__storeDebugState().refCount).toBe(0);
    expect(__taskDebugState().size).toBe(0);
  });
});
