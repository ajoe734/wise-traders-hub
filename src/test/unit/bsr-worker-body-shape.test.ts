import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Stage 3B / S3B-0 baseline test — worker 在 admission gate 關閉時的 exact body shape。
 *
 * Stage 2 的判定（provider_unsupported_plan）之後，唯一可信的「沒有打 provider」證據
 * 就是 worker 的 closed-gate 回應。這個形狀是 receipt 逐字引用的契約：
 *   ok: true / note: 'admission_gate_closed' / claimed: 0 / provider_calls: 0
 *   admission: { decision, blocked, reason, terminal_code, gate_version }
 * 任何人改動 worker 早退分支而讓欄位消失，這個 baseline 會 RED。
 */
const WORKER = resolve(
  process.cwd(),
  'supabase/functions/tw-bsr-finmind-sync/index.ts',
);
const src = readFileSync(WORKER, 'utf8');

describe('tw-bsr-finmind-sync closed-gate body shape', () => {
  it('worker 與 manual 兩條路徑都有 admission_gate_closed 早退', () => {
    const hits = src.match(/note:\s*'admission_gate_closed'/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('worker 早退回傳 claimed/processed/provider_calls 全為 0', () => {
    const i = src.indexOf("note: 'admission_gate_closed'");
    const block = src.slice(i, i + 900);
    expect(block).toMatch(/claimed:\s*0/);
    expect(block).toMatch(/processed:\s*0/);
    expect(block).toMatch(/provider_calls:\s*0/);
    expect(block).toMatch(/run_id:/);
  });

  it('admission 物件保留 5 個判讀欄位', () => {
    const i = src.indexOf("note: 'admission_gate_closed'");
    const block = src.slice(i, i + 900);
    for (const key of [
      'decision:',
      'blocked:',
      'reason:',
      'terminal_code:',
      'gate_version:',
    ]) {
      expect(block).toContain(key);
    }
  });

  it('gate 判定發生在任何 claim / provider 呼叫之前', () => {
    const gate = src.indexOf('fetchAdmissionStatus(');
    const claim = src.indexOf('claim_bsr_queue_jobs');
    expect(gate).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(claim);
  });
});
