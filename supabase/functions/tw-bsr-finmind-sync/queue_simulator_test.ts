// queue_simulator_test.ts
// 這支測試不打 DB、不打 FinMind。
// 它用純 TS 建立一個 in-memory 佇列，鏡射 tw_bsr_sync_queue 的關鍵合約：
//   - unique(stock_id, trade_date) WHERE status IN ('pending','running') → 併發入隊只保留 1 筆
//   - claim: FOR UPDATE SKIP LOCKED，priority ASC, next_run_at ASC；併發不會拿到同一 job
//   - 失敗：attempts++，指數退避 next_run_at（對齊 decideFailureRetry）
//   - crash：running 但 started_at 超過 grace period 應可被 recovery 重放
// 用來鎖住 index.ts / migration 對佇列的假設不會悄悄漂移。
//
// 執行：
//   deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/queue_simulator_test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decideFailureRetry } from './lib.ts';

type Status = 'pending' | 'running' | 'done' | 'failed';
type Job = {
  id: number;
  stock_id: string;
  trade_date: string;
  priority: number;
  status: Status;
  attempts: number;
  max_attempts: number;
  next_run_at: number;   // epoch ms
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
};

class InMemQueue {
  private nextId = 1;
  jobs: Job[] = [];
  now = () => Date.now();
  private mu = Promise.resolve();

  /** 串行化 critical section，模擬 DB row-lock */
  private async lock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const prev = this.mu;
    this.mu = new Promise((r) => (release = r));
    await prev;
    try { return await fn(); } finally { release(); }
  }

  async enqueue(stock_id: string, trade_date: string, priority = 1): Promise<'inserted' | 'skipped'> {
    return this.lock(() => {
      const exists = this.jobs.some(
        (j) => j.stock_id === stock_id && j.trade_date === trade_date &&
               (j.status === 'pending' || j.status === 'running'),
      );
      if (exists) return 'skipped';
      this.jobs.push({
        id: this.nextId++, stock_id, trade_date, priority,
        status: 'pending', attempts: 0, max_attempts: 5,
        next_run_at: this.now(), started_at: null, finished_at: null, last_error: null,
      });
      return 'inserted';
    });
  }

  async claim(batch: number, maxPriority = 3): Promise<Job[]> {
    return this.lock(() => {
      const t = this.now();
      const eligible = this.jobs
        .filter((j) => j.status === 'pending' && j.priority <= maxPriority && j.next_run_at <= t)
        .sort((a, b) => a.priority - b.priority || a.next_run_at - b.next_run_at || a.id - b.id)
        .slice(0, batch);
      for (const j of eligible) {
        j.status = 'running';
        j.attempts += 1;
        j.started_at = t;
      }
      return eligible.map((j) => ({ ...j }));
    });
  }

  async markSuccess(id: number) {
    return this.lock(() => {
      const j = this.jobs.find((x) => x.id === id)!;
      j.status = 'done';
      j.finished_at = this.now();
      j.last_error = null;
    });
  }

  async markFailure(id: number, err: string) {
    return this.lock(() => {
      const j = this.jobs.find((x) => x.id === id)!;
      const d = decideFailureRetry({ attempts: j.attempts, maxAttempts: j.max_attempts, nowMs: this.now() });
      j.status = d.status;
      j.last_error = err;
      j.next_run_at = d.nextRunAt ? Date.parse(d.nextRunAt) : Number.MAX_SAFE_INTEGER;
      j.started_at = null;
      j.finished_at = d.status === 'failed' ? this.now() : null;
    });
  }

  /** crash recovery：running 但 started_at 早於 cutoff → 視同 pending 可再取 */
  async recoverStuck(graceMs: number) {
    return this.lock(() => {
      const cutoff = this.now() - graceMs;
      let n = 0;
      for (const j of this.jobs) {
        if (j.status === 'running' && (j.started_at ?? 0) < cutoff) {
          j.status = 'pending';
          j.started_at = null;
          n++;
        }
      }
      return n;
    });
  }
}

// -------------------- 情境 1：重複入隊只保留 1 筆 --------------------
Deno.test('enqueue: 併發同一 (stock, date) 只保留一筆', async () => {
  const q = new InMemQueue();
  const results = await Promise.all(
    Array.from({ length: 50 }, () => q.enqueue('2330', '2026-07-18', 1)),
  );
  const inserted = results.filter((r) => r === 'inserted').length;
  const skipped = results.filter((r) => r === 'skipped').length;
  assertEquals(inserted, 1);
  assertEquals(skipped, 49);
  assertEquals(q.jobs.filter((j) => j.status === 'pending').length, 1);
});

// -------------------- 情境 2：併發 claim 互斥 --------------------
Deno.test('claim: 併發 worker 不會拿到同一 job', async () => {
  const q = new InMemQueue();
  for (let i = 0; i < 30; i++) await q.enqueue(String(1000 + i), '2026-07-18', 1);

  const workers = Array.from({ length: 5 }, () => q.claim(10));
  const claimed = (await Promise.all(workers)).flat();
  const uniqueIds = new Set(claimed.map((j) => j.id));
  assertEquals(claimed.length, uniqueIds.size, 'no worker should claim the same job');
  assertEquals(claimed.length, 30, 'all pending jobs eventually claimed');
});

// -------------------- 情境 3：priority 優先序 --------------------
Deno.test('claim: 先取 priority=1，再 2、再 3', async () => {
  const q = new InMemQueue();
  await q.enqueue('9001', '2026-07-18', 3);
  await q.enqueue('9002', '2026-07-18', 1);
  await q.enqueue('9003', '2026-07-18', 2);
  const first = await q.claim(1);
  assertEquals(first[0].stock_id, '9002');
  const second = await q.claim(1);
  assertEquals(second[0].stock_id, '9003');
  const third = await q.claim(1);
  assertEquals(third[0].stock_id, '9001');
});

// -------------------- 情境 4：失敗指數退避、達上限 fail --------------------
Deno.test('failure: 每次失敗 next_run_at 遞增、達上限標 failed', async () => {
  const q = new InMemQueue();
  await q.enqueue('2330', '2026-07-18', 1);
  const t0 = q.now();
  for (let i = 0; i < 4; i++) {
    const [job] = await q.claim(1);
    await q.markFailure(job.id, 'finmind_http_500');
    // 未達 max=5 應為 pending 且 next_run_at 在未來
    const j = q.jobs[0];
    assertEquals(j.status, 'pending');
    assert(j.next_run_at > t0, `attempt ${i}: next_run_at should be in future`);
    // 立刻再 claim 應該取不到（因為 next_run_at 還沒到）
    const again = await q.claim(1);
    assertEquals(again.length, 0);
    // 強行把 next_run_at 拉回 now 讓迴圈繼續
    j.next_run_at = q.now();
  }
  // 第 5 次失敗 → failed
  const [job5] = await q.claim(1);
  await q.markFailure(job5.id, 'finmind_http_500');
  assertEquals(q.jobs[0].status, 'failed');
  // failed 不再被 claim
  const empty = await q.claim(10);
  assertEquals(empty.length, 0);
});

// -------------------- 情境 5：worker crash 恢復 --------------------
Deno.test('recovery: running 超過 grace 應可被 recoverStuck 重取', async () => {
  const q = new InMemQueue();
  await q.enqueue('2330', '2026-07-18', 1);
  const [job] = await q.claim(1);
  assertEquals(job.status, 'running');
  // 模擬 worker 在 request 前後 crash（沒有機會 mark success/failure）
  // 手動把 started_at 拉到過去
  q.jobs[0].started_at = q.now() - 60 * 60_000;
  const recovered = await q.recoverStuck(30 * 60_000);
  assertEquals(recovered, 1);
  assertEquals(q.jobs[0].status, 'pending');
  const [again] = await q.claim(1);
  assertEquals(again.id, job.id);
  assertEquals(again.attempts, 2); // 二次取件 attempts 累加
});

// -------------------- 情境 6：done 後同 (stock,date) 可以被再入隊嗎？ --------------------
Deno.test('enqueue: 已 done 的 (stock,date) 允許再入隊（unique 只針對 pending/running）', async () => {
  const q = new InMemQueue();
  await q.enqueue('2330', '2026-07-18', 1);
  const [job] = await q.claim(1);
  await q.markSuccess(job.id);
  const r = await q.enqueue('2330', '2026-07-18', 1);
  assertEquals(r, 'inserted');
});

// -------------------- 情境 7：全域配額耗盡時 worker 主動停手 --------------------
Deno.test('rate-limit stop：worker 拿到 rate-limited 訊號後不再處理剩餘 job', async () => {
  const q = new InMemQueue();
  for (let i = 0; i < 20; i++) await q.enqueue(String(2000 + i), '2026-07-18', 1);
  const jobs = await q.claim(20);
  // 模擬 index.ts 的行為：處理到第 3 筆時被限流，剩下的還原成 pending
  let rateLimitedStop = false;
  let processed = 0;
  for (const j of jobs) {
    if (rateLimitedStop) {
      // 還原 job（模擬「未處理」）
      q.jobs.find((x) => x.id === j.id)!.status = 'pending';
      q.jobs.find((x) => x.id === j.id)!.started_at = null;
      continue;
    }
    processed++;
    if (processed === 3) {
      await q.markFailure(j.id, 'rate_limit_exhausted');
      rateLimitedStop = true;
    } else {
      await q.markSuccess(j.id);
    }
  }
  const stillPending = q.jobs.filter((x) => x.status === 'pending').length;
  const done = q.jobs.filter((x) => x.status === 'done').length;
  assertEquals(done, 2);            // 前兩筆成功
  assertEquals(stillPending, 17 + 1); // 17 未處理 + 1 rate_limited 退避
});
