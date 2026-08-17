import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  MAX_CLAIM_BATCH,
  TERMINAL_CODE,
  blockAndTerminalize,
  classifyChunkOutcome,
  classifyProviderError,
  evaluateAdmission,
  fetchAdmissionStatus,
  sanitizeEvidence,
  sanitizeText,
  summarizeChunks,
  unknownRetryAllowed,
  type AdmissionStatus,
  type GateRpcClient,
  type RpcResult,
} from './bsrAdmissionGate.ts';

const openRow = { exists: true, blocked: false, version: 7 };
const blockedRow = {
  exists: true, blocked: true, version: 7, nonce: 'n-1',
  reason: 'provider plan rejected', terminal_code: TERMINAL_CODE,
  blocked_at: '2026-08-17T00:00:00Z',
};

// ------------------------------------------------------------ evaluateAdmission

Deno.test('admission: open → allowed', () => {
  const s = evaluateAdmission({ data: openRow, error: null });
  assertEquals(s.allowed, true);
  assertEquals(s.decision, 'open');
  assertEquals(s.nonce, null);
});

Deno.test('admission: blocked → 不 allowed，帶 version/nonce', () => {
  const s = evaluateAdmission({ data: blockedRow, error: null });
  assertEquals(s.allowed, false);
  assertEquals(s.decision, 'blocked');
  assertEquals(s.version, 7);
  assertEquals(s.nonce, 'n-1');
});

Deno.test('admission: 單元素陣列包裝也能解', () => {
  assertEquals(evaluateAdmission({ data: [openRow], error: null }).decision, 'open');
});

Deno.test('admission: 多元素陣列 → malformed fail-closed', () => {
  const s = evaluateAdmission({ data: [openRow, openRow], error: null });
  assertEquals(s.allowed, false);
  assertEquals(s.decision, 'malformed');
});

Deno.test('admission: rpc error → fail-closed', () => {
  const s = evaluateAdmission({ data: null, error: { message: 'boom' } });
  assertEquals(s.allowed, false);
  assertEquals(s.decision, 'rpc_error');
});

Deno.test('admission: null / 非物件 → malformed', () => {
  assertEquals(evaluateAdmission({ data: null, error: null }).decision, 'malformed');
  assertEquals(evaluateAdmission({ data: 5, error: null }).decision, 'malformed');
});

Deno.test('admission: gate row 不存在 → missing（不是當作開著）', () => {
  const s = evaluateAdmission({ data: { exists: false }, error: null });
  assertEquals(s.allowed, false);
  assertEquals(s.decision, 'missing');
});

Deno.test('admission: blocked 非 boolean / version 非整數 → malformed', () => {
  assertEquals(evaluateAdmission({ data: { exists: true, blocked: 'no', version: 1 }, error: null }).decision, 'malformed');
  assertEquals(evaluateAdmission({ data: { exists: true, blocked: false, version: 1.5 }, error: null }).decision, 'malformed');
  assertEquals(evaluateAdmission({ data: { exists: true, blocked: false }, error: null }).decision, 'malformed');
});

Deno.test('fetchAdmissionStatus: client throw 也 fail-closed，不外洩例外', async () => {
  const client: GateRpcClient = { rpc: () => Promise.reject(new Error('network down')) };
  const s = await fetchAdmissionStatus(client);
  assertEquals(s.allowed, false);
  assertEquals(s.decision, 'rpc_error');
});

// ------------------------------------------------------------ sanitize

Deno.test('sanitizeText: URL / bearer / key=value 被遮蔽', () => {
  const out = sanitizeText('call https://api.finmindtrade.com/x?token=abcdef Bearer sk_live_1234567890');
  assert(!out.includes('https://'));
  assert(!out.toLowerCase().includes('sk_live_1234567890'));
});

Deno.test('sanitizeEvidence: 禁字 key 被移除', () => {
  const e = sanitizeEvidence({ token: 'x', api_key: 'y', raw_body: 'z', http_status: '400' });
  assertEquals(Object.keys(e), ['http_status']);
});

// ------------------------------------------------------------ provider classify

Deno.test('classifyProviderError: 方案拒絕 → terminal', () => {
  const c = classifyProviderError('http_400:Your level is register, please upgrade your level.');
  assertEquals(c.outcome, 'terminal');
});

Deno.test('classifyProviderError: 429 / 5xx → retryable', () => {
  assertEquals(classifyProviderError('http_429:rate limit').outcome, 'retryable');
  assertEquals(classifyProviderError('http_503:bad gateway').outcome, 'retryable');
});

Deno.test('classifyProviderError: 空 → none；未知 → unknown', () => {
  assertEquals(classifyProviderError(null).outcome, 'none');
  assertEquals(classifyProviderError('weird thing happened').outcome, 'unknown');
});

Deno.test('unknownRetryAllowed 有界', () => {
  assertEquals(unknownRetryAllowed(1, 3), true);
  assertEquals(unknownRetryAllowed(3, 3), false);
});

// ------------------------------------------------------------ blockAndTerminalize

function scriptedClient(steps: Array<RpcResult | Error>): { client: GateRpcClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const client: GateRpcClient = {
    rpc: (_fn, args) => {
      calls.push(args ?? {});
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve(step);
    },
  };
  return { client, calls };
}

const claims = [
  { id: 1, started_at: '2026-08-17T00:00:00Z', attempts: 1 },
  { id: 2, started_at: '2026-08-17T00:00:01Z', attempts: 0 },
];
const noSleep = () => Promise.resolve();

Deno.test('block: 成功回 blocked，送出 pairwise claim 陣列與固定 terminal code', async () => {
  const { client, calls } = scriptedClient([
    { data: { transition: 'blocked', gate_version: 8, claim_count: 2, updated_count: 2, lost_lease_count: 0 }, error: null },
  ]);
  const r = await blockAndTerminalize(client, { runId: 'r1', claims, evidence: { http_status: '400' }, sleep: noSleep });
  assertEquals(r.ok, true);
  assertEquals(r.transition, 'blocked');
  assertEquals(r.updatedCount, 2);
  assertEquals(r.attemptsUsed, 1);
  assertEquals(calls[0].p_claim_ids, [1, 2]);
  assertEquals(calls[0].p_claim_attempts, [1, 0]);
  assertEquals(calls[0].p_terminal_code, TERMINAL_CODE);
});

Deno.test('block: 第二次呼叫 already_blocked 仍算成功（idempotent）', async () => {
  const { client } = scriptedClient([
    { data: { transition: 'already_blocked', gate_version: 8, claim_count: 2, updated_count: 0 }, error: null },
  ]);
  const r = await blockAndTerminalize(client, { runId: 'r1', claims, evidence: {}, sleep: noSleep });
  assertEquals(r.ok, true);
  assertEquals(r.transition, 'already_blocked');
  assertEquals(r.lostLeaseCount, 2);
});

Deno.test('block: 基礎設施錯誤重試後成功', async () => {
  const { client, calls } = scriptedClient([
    { data: null, error: { message: 'connection reset' } },
    { data: { transition: 'blocked', gate_version: 8, claim_count: 2, updated_count: 2 }, error: null },
  ]);
  const r = await blockAndTerminalize(client, { runId: 'r1', claims, evidence: {}, sleep: noSleep });
  assertEquals(r.ok, true);
  assertEquals(r.attemptsUsed, 2);
  assertEquals(calls.length, 2);
});

Deno.test('block: 契約錯誤不重試', async () => {
  const { client, calls } = scriptedClient([
    { data: null, error: { message: 'terminal_code_not_allowed' } },
  ]);
  const r = await blockAndTerminalize(client, { runId: 'r1', claims, evidence: {}, sleep: noSleep });
  assertEquals(r.ok, false);
  assertEquals(calls.length, 1);
});

Deno.test('block: 重試用盡不得假成功', async () => {
  const { client, calls } = scriptedClient([new Error('timeout')]);
  const r = await blockAndTerminalize(client, { runId: 'r1', claims, evidence: {}, sleep: noSleep, maxAttempts: 3 });
  assertEquals(r.ok, false);
  assertEquals(r.transition, null);
  assertEquals(calls.length, 3);
});

Deno.test('block: 未知 transition 直接失敗', async () => {
  const { client } = scriptedClient([{ data: { transition: 'weird' }, error: null }]);
  const r = await blockAndTerminalize(client, { runId: 'r1', claims, evidence: {}, sleep: noSleep });
  assertEquals(r.ok, false);
});

Deno.test('block: claim 批量硬上限 500', async () => {
  const many = Array.from({ length: 700 }, (_, i) => ({ id: i + 1, started_at: null, attempts: 0 }));
  const { client, calls } = scriptedClient([
    { data: { transition: 'blocked', gate_version: 8, claim_count: MAX_CLAIM_BATCH, updated_count: MAX_CLAIM_BATCH }, error: null },
  ]);
  await blockAndTerminalize(client, { runId: 'r1', claims: many, evidence: {}, sleep: noSleep });
  assertEquals((calls[0].p_claim_ids as number[]).length, MAX_CLAIM_BATCH);
});

Deno.test('block: evidence 先 sanitize 才送出', async () => {
  const { client, calls } = scriptedClient([
    { data: { transition: 'blocked', gate_version: 8, claim_count: 0, updated_count: 0 }, error: null },
  ]);
  await blockAndTerminalize(client, {
    runId: 'r1', claims: [], sleep: noSleep,
    evidence: { token: 'secret', http_status: '400' },
  });
  assertEquals(calls[0].p_sanitized_evidence, { http_status: '400' });
});

// ------------------------------------------------------------ chunk accounting

const st = (decision: AdmissionStatus['decision']): AdmissionStatus =>
  evaluateAdmission(
    decision === 'blocked' ? { data: blockedRow, error: null }
      : decision === 'open' ? { data: openRow, error: null }
      : { data: { exists: false }, error: null },
  );

Deno.test('chunk: blocked gate 才把差額記成 blocked', () => {
  const c = classifyChunkOutcome({ admission: st('blocked'), candidateCount: 10, insertedCount: 2, error: null });
  assertEquals(c.status, 'blocked');
  assertEquals(c.blockedCount, 8);
});

Deno.test('chunk: gate 開著的差額是 unknown，不得記 blocked', () => {
  const c = classifyChunkOutcome({ admission: st('open'), candidateCount: 10, insertedCount: 4, error: null });
  assertEquals(c.status, 'unknown');
  assertEquals(c.blockedCount, null);
});

Deno.test('chunk: gate 開著且全插入 → inserted', () => {
  const c = classifyChunkOutcome({ admission: st('open'), candidateCount: 5, insertedCount: 5, error: null });
  assertEquals(c.status, 'inserted');
});

Deno.test('chunk: insert error → error，且不猜 blocked', () => {
  const c = classifyChunkOutcome({ admission: st('blocked'), candidateCount: 5, insertedCount: null, error: { message: 'dup key' } });
  assertEquals(c.status, 'error');
  assertEquals(c.blockedCount, null);
});

Deno.test('chunk: status 不可信 → unknown', () => {
  const c = classifyChunkOutcome({ admission: st('missing'), candidateCount: 5, insertedCount: 0, error: null });
  assertEquals(c.status, 'unknown');
  assertEquals(c.blockedCount, null);
});

Deno.test('summarizeChunks 聚合正確', () => {
  const s = summarizeChunks([
    classifyChunkOutcome({ admission: st('blocked'), candidateCount: 10, insertedCount: 0, error: null }),
    classifyChunkOutcome({ admission: st('open'), candidateCount: 5, insertedCount: 5, error: null }),
    classifyChunkOutcome({ admission: st('missing'), candidateCount: 3, insertedCount: 0, error: null }),
  ]);
  assertEquals(s.chunk_count, 3);
  assertEquals(s.candidate_count, 18);
  assertEquals(s.inserted_count, 5);
  assertEquals(s.blocked_count, 10);
  assertEquals(s.blocked_chunks, 1);
  assertEquals(s.unknown_chunks, 1);
});
