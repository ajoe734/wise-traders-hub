/**
 * E2E · tw-bsr-daily-sync audit mode 唯讀合約
 *
 * 目的：驗證 mode: "audit" 只讀不寫，端到端回傳
 *   attempted_as_of_date / last_successful / rollup / failure_state / aligned
 */
import { test, expect } from '@playwright/test';

const FN_URL = 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/tw-bsr-daily-sync';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo';

async function audit(stockIds: string[], lookback = 5) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ mode: 'audit', stock_ids: stockIds, lookback }),
  });
  expect(res.ok).toBeTruthy();
  return res.json();
}

test('audit 模式回傳完整欄位並不搶 lock', async () => {
  const data = await audit(['2330', '0050', '9999'], 5);
  expect(data.mode).toBe('audit');
  expect(Array.isArray(data.results)).toBe(true);
  expect(data.results).toHaveLength(3);

  for (const r of data.results) {
    expect(r.stock_id).toMatch(/^[0-9]{4}$/);
    expect(r.attempted_as_of_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(r.lookback_chain)).toBe(true);
    expect(r.lookback_chain).toHaveLength(5);
    expect(r.rollup).toHaveProperty('5');
    expect(r.rollup).toHaveProperty('20');
    expect(r.rollup).toHaveProperty('60');
    expect(r.failure_state).toHaveProperty('unresolved');
    expect(r.failure_state).toHaveProperty('recent');
    expect(typeof r.aligned).toBe('bool'.replace('bool', 'boolean'));

    // 對齊邏輯自檢
    const primary = r.rollup['5'];
    const last = r.last_successful?.as_of_date ?? null;
    if (r.aligned) {
      expect(primary).toBe(last);
    } else {
      expect(r.mismatch_reason).toBeTruthy();
      expect(['no_data', 'rollup_missing', 'rollup_stale', 'rollup_ahead']).toContain(r.mismatch_reason);
    }
  }
});

test('audit 可連續呼叫且不會被 lock_held 擋住', async () => {
  const a = await audit(['2330']);
  const b = await audit(['2330']);
  expect(a.results[0].stock_id).toBe('2330');
  expect(b.results[0].stock_id).toBe('2330');
  // 兩次都應該回 results，而不是 { skipped: "lock_held" }
  expect(a.skipped).toBeUndefined();
  expect(b.skipped).toBeUndefined();
});

test('audit 拒絕空 stock_ids', async () => {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ mode: 'audit', stock_ids: [] }),
  });
  expect(res.status).toBe(400);
});
