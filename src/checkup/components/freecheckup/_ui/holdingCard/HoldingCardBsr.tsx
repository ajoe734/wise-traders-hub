/**
 * HoldingCardBsr — 卡片層（不開抽屜）的籌碼狀態槽。
 *
 * 為什麼存在：`useChipsBatch` 只把資料寫進 TanStack Query 快取，唯一的 consumer 是抽屜；
 * 使用者不開抽屜就完全看不到「籌碼資料暫時無法取得」，形同靜默失敗。
 *
 * 憲法：
 *   - 只訂閱快取，**不發任何請求**（`enabled: false`，無 queryFn）。
 *   - 絕不觸碰 quantity / value / status / ROI：這裡不接收 `h.qty`、不 render 數字，
 *     也不提供任何 0 fallback；BSR 狀態與持倉數字完全解耦。
 *   - `available` / `loading` 只輸出 1×1 sr-only 節點，零版面影響；
 *     其他狀態沿用既有 absolute strip 機制（zIndex 低於 SyncErrorStrip 一級）。
 */
import { useQuery } from '@tanstack/react-query';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';
import { chipsBatchStatusKey, type ChipsBatchStatus } from '@/checkup/hooks/useChipsBatch';
import type { ChipsFetchResult } from '@/checkup/lib/chipsRepository';
import { resolveCardBsrState, bsrStateText, type BsrUiState } from '@/checkup/lib/bsrCanonicalCodes';

const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface HoldingCardBsrProps {
  code: string;
  /** 卡片已有 sync error strip 時只留 sr-only 節點，避免兩條 strip 疊字。 */
  suppressStrip?: boolean;
}

export function HoldingCardBsr({ code, suppressStrip = false }: HoldingCardBsrProps) {
  const chips = useQuery<ChipsFetchResult, unknown>({
    queryKey: chipsQueryKey(code),
    // 純訂閱：enabled:false 永不執行，queryFn 只為消除 TanStack 的缺 queryFn 警告。
    queryFn: () => Promise.reject(new Error('subscription-only')),
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  const status = useQuery<ChipsBatchStatus, unknown>({
    queryKey: chipsBatchStatusKey(code),
    queryFn: () => Promise.reject(new Error('subscription-only')),
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const payload = chips.data?.payload ?? null;
  const state: BsrUiState = resolveCardBsrState(chips.data ?? null, status.data ?? null);
  const asOf = payload?.bsr_as_of ?? null;
  const text = bsrStateText(state, asOf);

  const common = {
    'data-testid': 'holding-card-bsr',
    'data-bsr-state': state,
    'data-bsr-as-of': asOf ?? '',
  } as const;

  if (!text || suppressStrip) {
    return <span {...common} style={SR_ONLY}>{text}</span>;
  }

  return (
    <div
      {...common}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '3px 10px',
        fontSize: 10,
        letterSpacing: '0.04em',
        color: '#6b655c',
        background: 'rgba(0,0,0,0.045)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        zIndex: 3,
      }}
    >
      {text}
    </div>
  );
}

export default HoldingCardBsr;
