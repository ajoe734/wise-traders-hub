/**
 * P0_UNPUBLISHED_JOURNAL_EDIT_ISOLATION_V1 — 未公開週記「內容版本更新」提交 seam。
 *
 * 這支是 SignalEditor pending-mentor path 的**唯一**提交實作：
 * 把 RPC 呼叫抽成可注入的 adapter，讓 Preview harness / 測試能重用
 * 完全相同的判斷與錯誤對應，而不是另寫一套假的 submit 邏輯。
 *
 * 邊界：只呼叫 `update_pending_mentor_journal_batch`。
 * 絕不碰 trade_records / 持倉 projection / capital / 績效，也不發通知或 LINE。
 */

export interface PendingMentorRpcError {
  message?: string | null;
  code?: string | null;
}

export interface PendingMentorRpcArgs {
  _expert_id: string;
  _batch_id: string;
  _rows: unknown[];
}

/** RPC adapter：production 用 supabase.rpc，harness/測試用 mock。 */
export type PendingMentorRpc = (
  args: PendingMentorRpcArgs,
) => Promise<{ error?: PendingMentorRpcError | null }>;

export type PendingMentorSubmitResult =
  | { ok: true; count: number }
  | { ok: false; message: string };

/** RPC 錯誤 → 使用者看得懂的中文訊息（fail closed，永不假裝成功）。 */
export function mapPendingMentorRpcError(error: PendingMentorRpcError | null | undefined): string {
  const msg: string = error?.message || '';
  const code: string = error?.code || '';
  const notFound =
    code === 'PGRST202' ||
    msg.includes('Could not find the function') ||
    msg.includes('does not exist');

  if (notFound) return '更新功能尚未啟用（伺服器程序尚未上線），本次沒有任何變更寫入';
  if (msg.includes('forbidden') || msg.includes('unauthenticated')) return '沒有權限修改這位老師的週記';
  if (msg.includes('not_mentor')) return '這個帳號不是週記老師，無法用這種方式修改';
  if (msg.includes('not_pending')) return '這篇週記已經公開，不能再用「未公開內容更新」修改';
  if (msg.includes('row_set_change_unsupported')) return '未公開週記目前只能修改內容，不能新增或刪除股票列';
  if (msg.includes('batch_mismatch')) return '找不到這篇週記，請重新整理後再試';
  if (msg.includes('empty_rows')) return '沒有可儲存的內容';
  return msg || '更新失敗';
}

export async function submitPendingMentorEdit(args: {
  expertId: string;
  batchId: string;
  rows: unknown[];
  rpc: PendingMentorRpc;
}): Promise<PendingMentorSubmitResult> {
  const { expertId, batchId, rows, rpc } = args;
  const { error } = await rpc({ _expert_id: expertId, _batch_id: batchId, _rows: rows });
  if (error) return { ok: false, message: mapPendingMentorRpcError(error) };
  return { ok: true, count: rows.length };
}
