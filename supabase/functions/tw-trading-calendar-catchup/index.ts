// AUTH: cron
// tw-trading-calendar-catchup
//
// 週末與國定假日的自動補抓排程。解決兩件事：
//   1. 交易日曆維護：自動偵測臨時休市（颱風假等）寫回 tw_market_holidays，
//      讓 gap 掃描不再把假日當成永久缺口而空燒 FinMind 配額。
//   2. 補齊視窗：掃描近 N 個「交易日」內全市場層級缺資料的日子，
//      入列 chip_fact / institutional_daily 回填工作（由 backfill-worker 消費），
//      再對缺漏日做 materialize + reconcile，最後收斂 BSR 視窗，
//      確保 1/5/10/20/60 日視窗不會因為連假而少一天。
//
// 排程（pg_cron）：
//   - 週六 02:00 UTC（台北 10:00）
//   - 週日 03:00 UTC（台北 11:00）
//   - 每日 22:30 UTC（台北隔日 06:30）— 連假結束後第一個交易日開盤前補完
//
// Payload: { lookback_days?: number, max_dispatch?: number, dry_run?: boolean }

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { checkKillSwitch } from '../_shared/killSwitch.ts';
import {
  taipeiTodayIso,
  lastNTwTradingDays,
  prevTwTradingDay,
} from '../_shared/twTradingCalendar.ts';

interface GapRow { stock_id: string; start_date: string; end_date: string; gap_count: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try { requireCronKey(req); }
  catch (e) {
    if (e instanceof AuthError) {
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: e.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    throw e;
  }

  const started = Date.now();
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const lookbackDays = Math.max(5, Math.min(120, Number(body?.lookback_days ?? 20)));
  const maxDispatch = Math.max(0, Math.min(2000, Number(body?.max_dispatch ?? 400)));
  const dryRun = Boolean(body?.dry_run);
  const triggerSource = String(body?.trigger_source ?? 'cron');

  const supa = serviceClient();
  const report: Record<string, unknown> = { run_id: runId, started_at: startedAt, dry_run: dryRun };
  // pg_net 的預設 timeout 只有 5 秒，掃描 + 收斂遠超過；改為背景執行，
  // 立即回 202，結果一律落在 data_source_refresh_logs（source_key=tw_trading_calendar_catchup）。
  const background = body?.background !== false;

  const run = async (): Promise<Response> => {
  try {
    // kill switch 只擋「入列回填 / 收斂視窗」這種會打上游的動作；
    // 日曆維護與缺口盤點永遠要跑，否則熔斷期間假日表會停止更新。
    const backfillEnabled = await checkKillSwitch(supa, 'chips_backfill');
    report.backfill_enabled = backfillEnabled;


    const today = taipeiTodayIso();
    // 只補到「最近一個已收盤的交易日」為止：今天若還在盤中不算缺口。
    const anchor = prevTwTradingDay(today);
    const window = lastNTwTradingDays(anchor, lookbackDays);
    const fromIso = window[0] ?? anchor;
    report.anchor_date = anchor;
    report.window_from = fromIso;
    report.window_trading_days = window.length;

    // 1) 自動偵測臨時休市（颱風假 / 臨時休市）
    const { data: detected, error: detErr } = await supa.rpc('tw_detect_market_holidays', {
      _from: fromIso, _to: anchor,
    });
    if (detErr) throw new Error(`tw_detect_market_holidays: ${detErr.message}`);
    report.auto_holidays = detected ?? [];

    // 2) 全市場層級缺資料的交易日（假日已被上一步排除）
    const { data: missing, error: missErr } = await supa.rpc('tw_missing_trading_days', {
      _from: fromIso, _to: anchor,
    });
    if (missErr) throw new Error(`tw_missing_trading_days: ${missErr.message}`);
    const missingDays = (missing ?? []) as Array<{ trade_date: string; bsr_rows: number; inst_rows: number }>;
    report.missing_days = missingDays;

    // 3) 個股層級缺口掃描 → 入列回填工作
    const [chipScan, instScan] = await Promise.all([
      supa.rpc('detect_chip_gap_jobs', { _target_date: anchor, _lookback_days: lookbackDays, _max_jobs: 2000 }),
      supa.rpc('detect_institutional_gap_jobs', { _target_date: anchor, _lookback_days: lookbackDays, _max_jobs: 2000 }),
    ]);
    if (chipScan.error) throw new Error(`detect_chip_gap_jobs: ${chipScan.error.message}`);
    if (instScan.error) throw new Error(`detect_institutional_gap_jobs: ${instScan.error.message}`);

    const chipGaps = (chipScan.data ?? []) as GapRow[];
    const instGaps = (instScan.data ?? []) as GapRow[];
    report.scan = {
      chip_stocks: chipGaps.length,
      inst_stocks: instGaps.length,
      chip_missing_days: chipGaps.reduce((s, g) => s + (g.gap_count || 0), 0),
      inst_missing_days: instGaps.reduce((s, g) => s + (g.gap_count || 0), 0),
    };

    let budget = maxDispatch;
    const jobs: Array<Record<string, unknown>> = [];
    const push = (dataset: string, gaps: GapRow[]) => {
      for (const g of gaps) {
        if (budget <= 0) break;
        jobs.push({
          dataset,
          stock_id: g.stock_id,
          start_date: g.start_date,
          end_date: g.end_date,
          priority_score: (g.gap_count || 0) + 20, // 補窗優先於一般 opportunistic 回填
          source_hint: 'finmind',
          max_attempts: 3,
          payload: { trigger_source: triggerSource, run_id: runId, reason: 'calendar_catchup' },
        });
        budget -= 1;
      }
    };
    push('chip_fact', chipGaps);
    push('institutional_daily', instGaps);

    let inserted = 0, skipped = 0;
    if (!dryRun && backfillEnabled && jobs.length > 0) {
      const { data, error } = await supa.rpc('enqueue_backfill_jobs', { _jobs: jobs });
      if (error) throw new Error(`enqueue_backfill_jobs: ${error.message}`);
      inserted = (data as { inserted?: number })?.inserted ?? 0;
      skipped = (data as { skipped?: number })?.skipped ?? 0;
    }
    report.jobs_submitted = jobs.length;
    report.inserted = inserted;
    report.skipped = skipped;

    // 4) 對缺漏日重新 materialize + reconcile（已抓進 fact 但沒提拔的情況）
    const reconciled: Array<{ trade_date: string; ok: boolean; error?: string }> = [];
    if (!dryRun) {
      for (const m of missingDays.slice(0, 15)) {
        const d = String(m.trade_date).slice(0, 10);
        const { error: mErr } = await supa.rpc('materialize_bsr_daily_from_fact', { _trade_date: d });
        const { error: rErr } = mErr ? { error: mErr } : await supa.rpc('reconcile_snapshot', { _trade_date: d });
        reconciled.push({ trade_date: d, ok: !mErr && !rErr, error: (mErr ?? rErr)?.message });
      }
    }
    report.reconciled = reconciled;

    // 5) 收斂視窗，確保每檔持倉的 1/5/10/20/60 日視窗補齊
    if (!dryRun && backfillEnabled) {
      const { data: conv, error: convErr } = await supa.rpc('converge_bsr_windows', {
        p_max_stocks: 60, p_chunk_dates: 15, p_horizon_days: 110,
      });
      if (convErr) report.converge_error = convErr.message;
      else report.converge = conv;
    }

    report.duration_ms = Date.now() - started;
    report.ok = true;

    try {
      await supa.from('data_source_refresh_logs').insert({
        source_key: 'tw_trading_calendar_catchup',
        status: 'done',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: report.duration_ms as number,
        row_count: inserted,
        metadata: report,
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify(report), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    report.ok = false;
    report.error = msg;
    report.duration_ms = Date.now() - started;
    console.error('[tw-trading-calendar-catchup] failed:', msg);
    try {
      await supa.from('data_source_refresh_logs').insert({
        source_key: 'tw_trading_calendar_catchup',
        status: 'error',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: report.duration_ms as number,
        metadata: { run_id: runId, error: msg.slice(0, 500) },
      });
    } catch { /* ignore */ }
    return new Response(JSON.stringify(report), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  };

  if (background) {
    // @ts-ignore EdgeRuntime 由 Supabase Edge Runtime 注入
    EdgeRuntime.waitUntil(run());
    return new Response(JSON.stringify({ ok: true, accepted: true, run_id: runId }), {
      status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return await run();
});
