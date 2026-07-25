// useChipsState — 前端統一 5 態機（PR-6）
// 將 useTwChipsDetail 回傳的 payload 收斂為 5 個顯示狀態，
// UI 只讀 state/subState/reason，不再各自判斷 readiness/freshness/error。
//
// 5 states（對應 V4 計畫）：
//   ineligible          → ETF/權證/受益憑證/DR 等，永遠不進 sync
//   upstream_outage     → 上游熔斷或多次失敗 dead；或 error.kind=server
//   filling_new_stock   → 佇列 pending/running 中（含 not_queued + 尚未 fresh）
//   d1_fallback         → 有資料但只覆蓋 D-1；或 bsr_freshness_status=lagging
//   ready               → BSR fresh 且 institutional d5 有值
//
// 額外欄位 subState 保留原始細節（供 telemetry / 除錯）。
import { useEffect, useMemo, useRef } from 'react';
import { trackEvent } from '@/lib/trafficTracker';
import type { ChipsError, TwChipsPayload } from './useTwChipsDetail';

export type ChipsUIState =
  | 'ineligible'
  | 'upstream_outage'
  | 'filling_new_stock'
  | 'd1_fallback'
  | 'ready';

export interface ChipsStateResult {
  state: ChipsUIState;
  /** 顯示給使用者的一句話 */
  reason: string;
  /** 原始細節：BSR freshness / queue / readiness / error kind */
  subState: {
    bsr_freshness: TwChipsPayload['bsr_freshness_status'] | null;
    bsr_queue_status: TwChipsPayload['bsr_sync_status'] extends infer T
      ? T extends { status: infer S } ? S | null : null
      : null;
    inst_d5_state: 'ready' | 'filling' | 'upstream_exhausted' | 'no_data' | null;
    error_kind: ChipsError['kind'] | null;
    ineligible_reason: string | null;
  };
  /** UI 是否應顯示「補齊中」spinner／輪詢圖示 */
  isPolling: boolean;
  /** UI 是否應顯示「僅 D-1」badge */
  isD1Fallback: boolean;
}

/**
 * 依 hook payload 推導 5 態。純函式，可單獨測試。
 */
export function deriveChipsState(
  payload: TwChipsPayload | null,
  err: ChipsError | null,
  opts: { chipEligible: boolean } = { chipEligible: true },
): ChipsStateResult {
  // 1. Ineligible：ETF/權證等直接命中，早退
  if (!opts.chipEligible) {
    return {
      state: 'ineligible',
      reason: '此代號為 ETF／權證／受益憑證，無分點資料',
      subState: {
        bsr_freshness: null, bsr_queue_status: null,
        inst_d5_state: null, error_kind: null,
        ineligible_reason: 'not_common_stock',
      },
      isPolling: false, isD1Fallback: false,
    };
  }
  const bsrFresh = payload?.bsr_freshness_status ?? null;
  const queueStatus = payload?.bsr_sync_status?.status ?? null;
  const instRd = payload?.readiness?.institutional?.['5']?.state ?? null;
  const errKind = err?.kind ?? null;

  // 2. Ineligible（後端判定 asset_class 不支援）
  if (bsrFresh === 'ineligible' || queueStatus === 'ineligible') {
    const reason = payload?.bsr_sync_status?.ineligible_reason ?? null;
    return {
      state: 'ineligible',
      reason: reason === 'unsupported_asset_type'
        ? 'ETF／權證無分點資料'
        : reason === 'missing_instrument'
          ? '尚無此代號 metadata'
          : '此代號不支援分點',
      subState: {
        bsr_freshness: bsrFresh, bsr_queue_status: queueStatus,
        inst_d5_state: instRd, error_kind: errKind,
        ineligible_reason: reason,
      },
      isPolling: false, isD1Fallback: false,
    };
  }

  // 3. Upstream outage：server 5xx、queue dead、readiness upstream_exhausted
  const outage =
    errKind === 'server' ||
    queueStatus === 'dead' ||
    instRd === 'upstream_exhausted' ||
    bsrFresh === 'sync_failed';
  if (outage) {
    return {
      state: 'upstream_outage',
      reason: queueStatus === 'dead'
        ? '多次同步失敗，請聯繫管理員'
        : errKind === 'server'
          ? '上游 API 暫時無法回應，請稍後重試'
          : '上游資料暫時無法取得，稍後將自動重試',
      subState: {
        bsr_freshness: bsrFresh, bsr_queue_status: queueStatus,
        inst_d5_state: instRd, error_kind: errKind, ineligible_reason: null,
      },
      isPolling: false, isD1Fallback: false,
    };
  }

  // 4. Filling：佇列 pending/running/not_queued 中且尚無最新資料
  const filling =
    bsrFresh === 'syncing' ||
    bsrFresh === 'not_queued' ||
    bsrFresh === 'no_data' ||
    queueStatus === 'pending' ||
    queueStatus === 'running' ||
    instRd === 'filling' ||
    instRd === 'no_data';
  if (filling && !payload?.bsr_as_of) {
    return {
      state: 'filling_new_stock',
      reason: queueStatus === 'running'
        ? '正在同步分點資料（約 5–15 分鐘）'
        : queueStatus === 'pending'
          ? '已排入同步佇列，稍後自動補齊'
          : '首次載入中，資料補齊中',
      subState: {
        bsr_freshness: bsrFresh, bsr_queue_status: queueStatus,
        inst_d5_state: instRd, error_kind: errKind, ineligible_reason: null,
      },
      isPolling: true, isD1Fallback: false,
    };
  }

  // 5. D-1 fallback：有資料但落後預期或只有 raw d5
  const d1 =
    bsrFresh === 'lagging' ||
    payload?.bsr_source === 'raw_fallback' ||
    ((payload?.as_of_lag_days ?? 0) >= 1);
  if (d1 && payload) {
    return {
      state: 'd1_fallback',
      reason: `顯示 ${(payload.bsr_as_of || payload.as_of || '').replaceAll('-', '/')} 資料（前 ${payload.as_of_lag_days ?? 1} 個交易日）`,
      subState: {
        bsr_freshness: bsrFresh, bsr_queue_status: queueStatus,
        inst_d5_state: instRd, error_kind: errKind, ineligible_reason: null,
      },
      isPolling: false, isD1Fallback: true,
    };
  }

  // 6. Ready
  return {
    state: 'ready',
    reason: '資料已為最新交易日',
    subState: {
      bsr_freshness: bsrFresh, bsr_queue_status: queueStatus,
      inst_d5_state: instRd, error_kind: errKind, ineligible_reason: null,
    },
    isPolling: false, isD1Fallback: false,
  };
}

/**
 * React hook 包裝：推導 state + 對每個狀態變化送出一次 `chips_state_resolved` 遙測。
 */
export function useChipsState(params: {
  stockCode: string;
  payload: TwChipsPayload | null;
  error: ChipsError | null;
  chipEligible: boolean;
}): ChipsStateResult {
  const { stockCode, payload, error, chipEligible } = params;
  const result = useMemo(
    () => deriveChipsState(payload, error, { chipEligible }),
    [payload, error, chipEligible],
  );

  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stockCode) return;
    const key = `${stockCode}::${result.state}::${result.subState.bsr_freshness ?? ''}::${result.subState.bsr_queue_status ?? ''}::${result.subState.inst_d5_state ?? ''}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    trackEvent('chips_state_resolved', {
      stock_code: stockCode,
      state: result.state,
      bsr_freshness: result.subState.bsr_freshness,
      bsr_queue_status: result.subState.bsr_queue_status,
      inst_d5_state: result.subState.inst_d5_state,
      error_kind: result.subState.error_kind,
      is_polling: result.isPolling,
      is_d1_fallback: result.isD1Fallback,
    });
  }, [stockCode, result]);

  return result;
}
