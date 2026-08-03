import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CallBudget,
  DEFAULT_FINMIND_CALLS_PER_RUN,
  FINMIND_MAX_ATTEMPTS_PER_CALL,
  MAX_FINMIND_CALLS_PER_RUN,
  MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN,
  deriveRunStatus,
  isQuotaExhaustion,
  materializeArgs,
  planChipFactDates,
  resolveCallBudget,
  resolveNextStart,
} from '../../../supabase/functions/_shared/backfillWorkerPlan';
import { fetchWithRetry } from '../../../supabase/functions/_shared/retryFetch';

const ROOT = path.resolve(__dirname, '../../..');
const WORKER = fs.readFileSync(path.join(ROOT, 'supabase/functions/backfill-worker/index.ts'), 'utf8');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const MIG_FILES = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();

/** scheduler-only 的 pg_cron job：命令必須經 cron_edge_call（會帶 X-Cron-Key）。 */
const SCHEDULER_ONLY_JOBS = [
  'backfill-gap-orchestrator-sunday',
  'backfill-gap-orchestrator-weeknight',
  'backfill-worker-dispatch',
];

/** 取最後一個「定義／改寫」該 job 排程的 migration 檔與其相關片段。 */
function latestScheduleCommand(jobName: string): { file: string; command: string } | null {
  let latest: { file: string; command: string } | null = null;
  for (const f of MIG_FILES) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    let cursor = sql.indexOf(`'${jobName}'`);
    while (cursor !== -1) {
      latest = { file: f, command: sql.slice(cursor, cursor + 1600) };
      cursor = sql.indexOf(`'${jobName}'`, cursor + 1);
    }
  }
  return latest;
}

describe('pg_cron scheduler-only commands', () => {
  for (const job of SCHEDULER_ONLY_JOBS) {
    it(`${job} 最新排程必須走 cron_edge_call，且完全不得出現裸 net.http_post`, () => {
      const latest = latestScheduleCommand(job);
      expect(latest, `找不到 ${job} 的 cron.schedule 定義`).not.toBeNull();
      const cmd = latest!.command;
      expect(/cron_edge_call/i.test(cmd), `${job} 在 ${latest!.file} 未使用 cron_edge_call`).toBe(true);
      expect(/net\.http_post/i.test(cmd), `${job} 在 ${latest!.file} 仍殘留 net.http_post`).toBe(false);
      // 不得把 anon key / X-Cron-Key 字面值寫進 cron.job.command
      expect(/eyJhbGciOi/i.test(cmd), `${job} 洩漏 JWT 字面值`).toBe(false);
      expect(/X-Cron-Key/i.test(cmd), `${job} 洩漏 X-Cron-Key header 字面值`).toBe(false);
    });
  }

  it('backfill-worker-dispatch 的 call_budget 必須 <= 10', () => {
    const latest = latestScheduleCommand('backfill-worker-dispatch');
    expect(latest).not.toBeNull();
    const m = latest!.command.match(/call_budget"?\s*:\s*(\d+)/);
    expect(m, 'cron 命令未帶 call_budget').not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(10);
  });
});

describe('FinMind 實際 HTTP attempts 硬上限', () => {
  it('常數關係：logical 上限 * 每 call attempts <= 30', () => {
    expect(MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN).toBeLessThanOrEqual(30);
    expect(MAX_FINMIND_CALLS_PER_RUN * FINMIND_MAX_ATTEMPTS_PER_CALL)
      .toBeLessThanOrEqual(MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN);
    expect(DEFAULT_FINMIND_CALLS_PER_RUN).toBeLessThanOrEqual(MAX_FINMIND_CALLS_PER_RUN);
  });

  it('最壞情境（每個 call 都重試到用盡）實際 HTTP attempts 仍 <= 30', async () => {
    const budget = new CallBudget(MAX_FINMIND_CALLS_PER_RUN);
    let realAttempts = 0;
    const fetchImpl = (async () => {
      realAttempts += 1;
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;

    while (budget.take(1) > 0) {
      await fetchWithRetry('https://example.test/api', {}, {
        source: 'finmind_bsr',
        policy: { maxAttempts: FINMIND_MAX_ATTEMPTS_PER_CALL, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 },
        sleep: async () => {},
        fetchImpl,
        onAttempt: () => budget.recordHttpAttempt(),
      }).catch(() => undefined);
    }

    expect(realAttempts).toBe(budget.httpAttempts);
    expect(realAttempts).toBeLessThanOrEqual(MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN);
  });

  it('attempt 上限會提前關閉 logical 名額', () => {
    const b = new CallBudget(MAX_FINMIND_CALLS_PER_RUN);
    b.take(1);
    for (let i = 0; i < MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN; i++) b.recordHttpAttempt();
    expect(b.exhausted).toBe(true);
    expect(b.take(1)).toBe(0);
  });

  it('外部輸入會被夾住', () => {
    expect(resolveCallBudget(1000)).toBe(MAX_FINMIND_CALLS_PER_RUN);
    expect(resolveCallBudget(0)).toBe(DEFAULT_FINMIND_CALLS_PER_RUN);
    expect(resolveCallBudget(undefined)).toBe(DEFAULT_FINMIND_CALLS_PER_RUN);
    expect(resolveCallBudget(5)).toBe(5);
  });

  it('worker 以 call budget 驅動，且把每次 HTTP attempt 回報給 budget', () => {
    expect(WORKER).toMatch(/CallBudget|resolveCallBudget/);
    expect(WORKER).toMatch(/onAttempt:\s*\(\)\s*=>\s*budget\?\.recordHttpAttempt\(\)/);
    expect(WORKER).toMatch(/maxAttempts:\s*FINMIND_MAX_ATTEMPTS_PER_CALL/);
    // 不得再硬寫 maxAttempts: 3（會與 budget 推導脫鉤）
    expect(WORKER).not.toMatch(/maxAttempts:\s*3\b/);
  });

  it('response / metadata 必須同時回 logical_calls 與 actual_http_attempts', () => {
    expect(WORKER).toMatch(/logical_calls/);
    expect(WORKER).toMatch(/actual_http_attempts/);
  });
});

describe('chip_fact checkpoint / resume', () => {
  const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];

  it('超出 budget 的日期會留到下一輪', () => {
    const plan = planChipFactDates(dates, 2);
    expect(plan.take).toEqual(['2026-07-01', '2026-07-02']);
    expect(plan.remaining).toEqual(['2026-07-03', '2026-07-04']);
    expect(plan.nextStart).toBe('2026-07-03');
  });

  it('budget 足夠時一次跑完且沒有 checkpoint', () => {
    const plan = planChipFactDates(dates, 10);
    expect(plan.take).toHaveLength(4);
    expect(plan.nextStart).toBeNull();
  });

  it('失敗日期必須成為 next_start，不可被越過', () => {
    expect(resolveNextStart('2026-07-02', ['2026-07-03', '2026-07-04'])).toBe('2026-07-02');
    expect(resolveNextStart(null, ['2026-07-03'])).toBe('2026-07-03');
    expect(resolveNextStart(null, [])).toBeNull();
  });

  it('worker 遇到非 quota 單日失敗必須停止並回指該日期', () => {
    expect(WORKER).toMatch(/firstFailedDate/);
    expect(WORKER).toMatch(/resolveNextStart\(firstFailedDate/);
    // 舊版以 okDates+failedDates 當 processed（會越過失敗日期）已禁止
    expect(WORKER).not.toMatch(/okDates\.length\s*\+\s*failedDates\.length/);
  });

  it('checkpoint 寫入失敗絕不可 fallback 成 done', () => {
    const region = WORKER.match(/checkpoint_failed[\s\S]{0,400}/)?.[0] ?? '';
    expect(region).not.toMatch(/backfill_job_set_done/);
    expect(region).toMatch(/releaseToPending/);
  });

  it('worker 具備 checkpoint 續跑路徑', () => {
    expect(WORKER).toMatch(/planChipFactDates/);
    expect(WORKER).toMatch(/checkpoint|resume|next_start/i);
  });
});

describe('materialize scope', () => {
  it('materializeArgs 一律帶 _stock_ids 且去重排序', () => {
    const args = materializeArgs('2330', ['2026-07-02', '2026-07-01', '2026-07-02']);
    expect(args).toEqual([
      { _trade_date: '2026-07-01', _stock_ids: ['2330'] },
      { _trade_date: '2026-07-02', _stock_ids: ['2330'] },
    ]);
  });

  it('worker 呼叫 materialize_bsr_daily_from_fact 時必須帶 _stock_ids', () => {
    const calls = WORKER.match(/materialize_bsr_daily_from_fact[\s\S]{0,160}/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const ok = /_stock_ids/.test(c) || /materialize_bsr_daily_from_fact\",\s*args\)/.test(c);
      expect(ok, `materialize 呼叫缺 _stock_ids: ${c}`).toBe(true);
    }
    expect(WORKER).toMatch(/materializeArgs\(/);
    expect(WORKER).not.toMatch(/materialize_bsr_daily_from_fact\",\s*\{\s*_trade_date:[^}]*\}/);
  });

  it('worker 不得對整段 job 日期逐日重算（禁用 materializeRange(start,end)）', () => {
    expect(WORKER).not.toMatch(/materializeRange\(\s*supa\s*,\s*job\.start_date/);
  });
});

describe('run status honesty', () => {
  it('全失敗 → failed，部分失敗 → partial，全成功 → done', () => {
    expect(deriveRunStatus([{ status: 'failed' }, { status: 'pending' }])).toBe('failed');
    expect(deriveRunStatus([{ status: 'done' }, { status: 'failed' }])).toBe('partial');
    expect(deriveRunStatus([{ status: 'done' }])).toBe('done');
    expect(deriveRunStatus([])).toBe('skipped');
  });

  it('純 budget/quota 安全釋放 → skipped，不是 failed', () => {
    expect(deriveRunStatus([{ status: 'pending' }, { status: 'skipped' }])).toBe('skipped');
    expect(deriveRunStatus([{ status: 'skipped' }])).toBe('skipped');
    expect(deriveRunStatus([{ status: 'done' }, { status: 'skipped' }])).toBe('partial');
  });

  it('quota 耗盡屬於可回 pending 的情境', () => {
    expect(isQuotaExhaustion('admission_rejected:daily_exhausted:pool=backfill')).toBe(true);
    expect(isQuotaExhaustion('BUDGET_EXHAUSTED')).toBe(true);
    expect(isQuotaExhaustion('finmind_http_500')).toBe(false);
  });

  it('worker 不得把 refresh log status 硬寫成 done', () => {
    const logInsert = WORKER.match(/data_source_refresh_logs[\s\S]{0,300}/)?.[0] ?? '';
    expect(logInsert).not.toMatch(/status:\s*["']done["']/);
    expect(logInsert).toMatch(/deriveRunStatus|runStatus/);
  });
});

describe('data_source_refresh_logs status constraint 相容性', () => {
  /** 掃描所有 edge function 實際寫入 data_source_refresh_logs 的 status 字面值。 */
  function writerStatuses(): Set<string> {
    const dir = path.join(ROOT, 'supabase/functions');
    const out = new Set<string>();
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8');
          if (!src.includes('data_source_refresh_logs')) continue;
          for (const m of src.matchAll(/data_source_refresh_logs[\s\S]{0,400}?status:\s*["'](\w+)["']/g)) {
            out.add(m[1]);
          }
        }
      }
    };
    walk(dir);
    return out;
  }

  /** 取最後一個定義 status check constraint 的 migration 允許值。 */
  function latestAllowed(): Set<string> | null {
    let allowed: Set<string> | null = null;
    for (const f of MIG_FILES) {
      const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
      if (!/data_source_refresh_logs_status_check/i.test(sql)) continue;
      const m = [...sql.matchAll(/CHECK\s*\(\s*status[\s\S]*?\)\s*;/gi)].pop();
      if (!m) continue;
      const vals = [...m[0].matchAll(/'([a-z_]+)'/gi)].map((x) => x[1]);
      if (vals.length) allowed = new Set(vals);
    }
    return allowed;
  }

  it('constraint 必須涵蓋所有 writer 實際使用的 status（含既有 done/failed）', () => {
    const allowed = latestAllowed();
    expect(allowed, '找不到 status check constraint migration').not.toBeNull();
    expect(allowed!.has('done')).toBe(true);
    expect(allowed!.has('failed')).toBe(true);
    const missing = [...writerStatuses()].filter((s) => !allowed!.has(s));
    expect(missing, `constraint 未涵蓋 writer 使用的 status: ${missing.join(',')}`).toEqual([]);
  });
});
