// 台股代號白名單 regex 回歸測試
// 執行：deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/enqueue_filter_test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';

// 與 index.ts 內 TW_STOCK_ID_WHITELIST 保持一致；若那邊改，這裡也要改。
const RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;

Deno.test('accepts 4-digit common stocks', () => {
  for (const id of ['2330', '2454', '2317', '1101', '2308']) {
    assertEquals(RE.test(id), true, `expected ${id} to pass`);
  }
});

Deno.test('accepts standard ETFs 00xx / 00xxx / 00xxxx', () => {
  for (const id of ['0050', '0056', '00878', '00631', '006203', '006208']) {
    assertEquals(RE.test(id), true, `expected ${id} to pass`);
  }
});

Deno.test('accepts ETF with leveraged/inverse suffix', () => {
  for (const id of ['00631L', '00632R', '00675L']) {
    assertEquals(RE.test(id), true, `expected ${id} to pass`);
  }
});

Deno.test('rejects 5-6 digit warrant / beneficiary certificate codes', () => {
  for (const id of ['071111', '068003', '069559', '707414', '051234', '087654']) {
    assertEquals(RE.test(id), false, `expected ${id} to be rejected`);
  }
});

Deno.test('rejects malformed input', () => {
  for (const id of ['', '12', '123', '12345', '1234567', 'ABCD', '2330-A', '2330 台積電']) {
    assertEquals(RE.test(id), false, `expected ${id} to be rejected`);
  }
});
