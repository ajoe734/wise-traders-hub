import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CallBudget,
  DEFAULT_FINMIND_CALLS_PER_RUN,
  MAX_FINMIND_CALLS_PER_RUN,
  deriveRunStatus,
  isQuotaExhaustion,
  materializeArgs,
  planChipFactDates,
  resolveCallBudget,
} from '../../../supabase/functions/_shared/backfillWorkerPlan';

const ROOT = path.resolve(__dirname, '../../..');
const WORKER = fs.readFileSync(path.join(ROOT, 'supabase/functions/backfill-worker/index.ts'), 'utf8');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');

/** scheduler-only 的 pg_cron job：命令必須經 cron_edge_call（會帶 X-Cron-Key）。 */
const SCHEDULER_ONLY_JOBS = [
  'backfill-gap-orchestrator-sunday',
  'backfill-gap-orchestrator-weeknight',
  'backfill-worker-dispatch',
];

/** 取最後一個「定義／改寫」該 job 排程的 migration 檔與其相關片段。 */
function latestScheduleCommand(jobName: string): { file: string; command: string } | null {
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  let latest: { file: string; command: string } | null = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    let cursor = sql.indexOf(`'${jobName}'`);
    while (cursor !== -1) {
      // 取 jobname 之後 1200 字元（涵蓋 cron.schedule 的 command 參數／VALUES tuple）
      latest = { file: f, command: sql.slice(cursor, cursor + 1200) };
      cursor = sql.indexOf(`'${jobName}'`, cursor + 1);
    }
  }
  return latest;
}


describe('pg_cron scheduler-only commands', () => {
  for (const job of SCHEDULER_ONLY_JOBS) {
    it(`${job} 最新排程走 cron_edge_call，不得 Authorization-only 直打 net.http_post`, () => {
      const latest = latestScheduleCommand(job);
      expect(latest, `找不到 ${job} 的 cron.schedule 定義`).not.toBeNull();
      const cmd = latest!.command;
      const rawPost = /net\.http_post/i.test(cmd);
      const wrapped = /cron_edge_call/i.test(cmd);
      expect(
        wrapped || !rawPost,
        `${job} 最新定義在 ${latest!.file} 仍用裸 net.http_post（無 X-Cron-Key）`,
      ).toBe(true);
    });
  }
});

describe('backfill-worker call budget', () => {
  it('硬上限不得超過 30 calls/hour', () => {
    expect(MAX_FINMIND_CALLS_PER_RUN).toBeLessThanOrEqual(30);
    expect(DEFAULT_FINMIND_CALLS_PER_RUN).toBeLessThanOrEqual(MAX_FINMIND_CALLS_PER_RUN);
  });

  it('外部輸入會被夾住', () => {
    expect(resolveCallBudget(1000)).toBe(MAX_FINMIND_CALLS_PER_RUN);
    expect(resolveCallBudget(0)).toBe(DEFAULT_FINMIND_CALLS_PER_RUN);
    expect(resolveCallBudget(undefined)).toBe(DEFAULT_FINMIND_CALLS_PER_RUN);
    expect(resolveCallBudget(5)).toBe(5);
  });

  it('CallBudget 會在耗盡後停止發放名額', () => {
    const b = new CallBudget(3);
    expect(b.take(2)).toBe(2);
    expect(b.take(5)).toBe(1);
    expect(b.exhausted).toBe(true);
    expect(b.take(1)).toBe(0);
    expect(b.spent).toBe(3);
  });

  it('worker 以 call budget 驅動，不能只用 batch_size 當 call 上限', () => {
    expect(WORKER).toMatch(/CallBudget|resolveCallBudget/);
    expect(WORKER).toMatch(/MAX_FINMIND_CALLS_PER_RUN|call_budget/);
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
      // 直接帶 args 物件（來自 materializeArgs，內含 _stock_ids）或行內帶 _stock_ids 皆可
      const ok = /_stock_ids/.test(c) || /materialize_bsr_daily_from_fact\",\s*args\)/.test(c);
      expect(ok, `materialize 呼叫缺 _stock_ids: ${c}`).toBe(true);
    }
    expect(WORKER).toMatch(/materializeArgs\(/);
    // 禁止任何不帶 _stock_ids 的行內參數
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

  it('quota 耗盡屬於可回 pending 的情境', () => {
    expect(isQuotaExhaustion('admission_rejected:daily_exhausted:pool=backfill')).toBe(true);
    expect(isQuotaExhaustion('finmind_http_500')).toBe(false);
  });

  it('worker 不得把 refresh log status 硬寫成 done', () => {
    const logInsert = WORKER.match(/data_source_refresh_logs[\s\S]{0,300}/)?.[0] ?? '';
    expect(logInsert).not.toMatch(/status:\s*["']done["']/);
    expect(logInsert).toMatch(/deriveRunStatus|runStatus/);
  });
});
