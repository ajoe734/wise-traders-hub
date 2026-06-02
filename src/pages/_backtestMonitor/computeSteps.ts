import type {
  BackfillSnapshot,
  FailedReason,
  NotifyLog,
  RunRow,
  StepInfo,
} from './types';
import { fmtDateTime } from './format';

interface Args {
  backfill: BackfillSnapshot | null;
  failedBackfillReasons: FailedReason[];
  runs: RunRow[];
  last24: RunRow[];
  success24: number;
  failed24: number;
  notifyLog: NotifyLog | null;
}

export function computeSteps({
  backfill,
  failedBackfillReasons,
  runs,
  last24,
  success24,
  failed24,
  notifyLog,
}: Args): StepInfo[] {
  const steps: StepInfo[] = [];

  // Step 1: 回填
  if (!backfill) {
    steps.push({ key: 'backfill', label: '① TWSE 日 K 回填', state: 'idle', detail: '載入中…' });
  } else if (backfill.failed > 0 && backfill.pending === 0) {
    steps.push({
      key: 'backfill', label: '① TWSE 日 K 回填', state: 'failed',
      detail: `${backfill.failed} 個批次失敗`,
      hint: failedBackfillReasons[0]?.reason ?? '請查看下方失敗清單',
    });
  } else if (backfill.pending === 0) {
    steps.push({
      key: 'backfill', label: '① TWSE 日 K 回填', state: 'done',
      detail: `${backfill.done} 完成 / ${backfill.empty} 無資料`,
    });
  } else if (backfill.recent_done_5min > 0) {
    steps.push({
      key: 'backfill', label: '① TWSE 日 K 回填', state: 'running',
      detail: `處理中 ${backfill.current_symbol ?? '?'} / ${backfill.current_yyyymm ?? '?'}`,
      hint: backfill.eta_minutes != null
        ? `預估剩 ${backfill.eta_minutes < 60 ? `${backfill.eta_minutes} 分` : `${(backfill.eta_minutes / 60).toFixed(1)} 小時`}`
        : undefined,
    });
  } else {
    const stuckMin = backfill.last_attempted_at
      ? Math.floor((Date.now() - new Date(backfill.last_attempted_at).getTime()) / 60_000)
      : null;
    steps.push({
      key: 'backfill', label: '① TWSE 日 K 回填', state: 'pending',
      detail: `${backfill.pending} 個批次待跑（近 5 分鐘無進度）`,
      hint: stuckMin != null
        ? `cron 每 5 分鐘自動續跑，上次嘗試 ${stuckMin} 分鐘前${stuckMin > 10 ? '（可能卡住，請查 edge function logs）' : ''}`
        : 'cron 每 5 分鐘自動續跑',
    });
  }

  // Step 2: 回測
  const lastFullRun = runs.find(r => r.run_mode === 'full');
  const recentBacktestFailed = last24.find(r => r.status === 'failed' && r.run_mode === 'full');
  if (!lastFullRun) {
    steps.push({
      key: 'backtest', label: '② knowledge-backtest 執行', state: 'idle',
      detail: '尚未執行過 full 回測',
      hint: backfill && backfill.pending === 0 ? '回填已完成，可手動觸發或等下次 cron' : '等回填完成自動觸發',
    });
  } else if (recentBacktestFailed) {
    steps.push({
      key: 'backtest', label: '② knowledge-backtest 執行', state: 'failed',
      detail: `最近失敗 ${fmtDateTime(recentBacktestFailed.created_at)}`,
      hint: recentBacktestFailed.error_message ?? '請查表格錯誤訊息',
    });
  } else if (lastFullRun.status === 'completed') {
    steps.push({
      key: 'backtest', label: '② knowledge-backtest 執行', state: 'done',
      detail: `${fmtDateTime(lastFullRun.completed_at ?? lastFullRun.created_at)}・${success24} 成功 / ${failed24} 失敗（24h）`,
    });
  } else {
    steps.push({
      key: 'backtest', label: '② knowledge-backtest 執行', state: 'running',
      detail: `狀態：${lastFullRun.status}`,
    });
  }

  // Step 3: Email 通知
  if (!notifyLog) {
    steps.push({
      key: 'notify', label: '③ Email 通知 admin', state: 'idle',
      detail: '尚無通知紀錄',
      hint: '回測完成後自動觸發',
    });
  } else if (notifyLog.email_failed > 0 && notifyLog.email_sent === 0) {
    steps.push({
      key: 'notify', label: '③ Email 通知 admin', state: 'failed',
      detail: `${fmtDateTime(notifyLog.created_at)}・全部失敗 ${notifyLog.email_failed}`,
      hint: notifyLog.errors[0] ?? '請檢查 RESEND_API_KEY',
    });
  } else if (notifyLog.email_failed > 0) {
    steps.push({
      key: 'notify', label: '③ Email 通知 admin', state: 'failed',
      detail: `${fmtDateTime(notifyLog.created_at)}・部分失敗 ${notifyLog.email_failed}/${notifyLog.email_sent + notifyLog.email_failed}`,
      hint: notifyLog.errors[0] ?? '查看 edge function logs',
    });
  } else {
    steps.push({
      key: 'notify', label: '③ Email 通知 admin', state: 'done',
      detail: `${fmtDateTime(notifyLog.created_at)}・寄出 ${notifyLog.email_sent} 封`,
    });
  }

  return steps;
}
