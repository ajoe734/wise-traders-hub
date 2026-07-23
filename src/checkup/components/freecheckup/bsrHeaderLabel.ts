// Pure helper for BSR header label mapping — extracted from ChipsSection
// so it can be unit-tested without pulling React / supabase.
//
// 對應驗收：ChipsSection 各狀態文案（unsupported / pending / running / failed / dead / not_queued / dataReady）

export type BsrSyncStatus = {
  eligible?: boolean;
  ineligible_reason?: string | null;
  status?: 'pending' | 'running' | 'failed' | 'dead' | 'done' | 'not_queued' | null;
  next_run_at?: string | null;
} | null | undefined;

export type BsrHeaderLabel = { text: string; tone: 'mute' | 'warn' | 'error' } | null;

export function fmtNextRun(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/**
 * @param syncStatus  ensure_bsr_queued / tw-chips-detail 回傳的同步狀態
 * @param hasAsOf     data.bsr_as_of 存在（已有實資料，改由 AS OF 顯示）
 */
export function bsrHeaderLabel(
  syncStatus: BsrSyncStatus,
  hasAsOf: boolean,
): BsrHeaderLabel {
  if (hasAsOf) return null;
  if (!syncStatus) return null;
  if (!syncStatus.eligible) {
    const reason = syncStatus.ineligible_reason;
    if (reason === 'unsupported_asset_type') return { text: 'ETF／權證無分點資料', tone: 'mute' };
    if (reason === 'missing_instrument') return { text: '尚無此代號 metadata', tone: 'mute' };
    return { text: '此代號不支援分點', tone: 'mute' };
  }
  if (syncStatus.status === 'running') return { text: 'BSR 同步進行中', tone: 'warn' };
  if (syncStatus.status === 'pending') {
    const t = fmtNextRun(syncStatus.next_run_at);
    return { text: t ? `已排入，${t} 起執行` : '已排入佇列', tone: 'warn' };
  }
  if (syncStatus.status === 'failed') {
    const t = fmtNextRun(syncStatus.next_run_at);
    return { text: t ? `暫時失敗，${t} 自動重試` : '暫時失敗，將自動重試', tone: 'warn' };
  }
  if (syncStatus.status === 'dead') return { text: '多次失敗，請聯繫管理員', tone: 'error' };
  if (syncStatus.status === 'not_queued') return { text: '尚未排入佇列（自動處理中）', tone: 'mute' };
  return null;
}
