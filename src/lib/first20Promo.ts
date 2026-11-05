/**
 * 「每位老師開站以來前 20 筆訂單不抽成」名次判定（純函式）。
 * 權威實作在資料庫 recompute_expert_promo；此檔為同規則鏡像，供測試與前端標示。
 * 規則：只算老師方案、已付款、非測試帳號、未全額退款；依付款時間排序，每位老師各自取前 N 名。
 */
export const FREE_ORDER_LIMIT = 20;

export interface PromoTxInput {
  transaction_id: string;
  expert_id: string | null;
  paid_at: string;
  checkup?: boolean;
  tester?: boolean;
  fullyRefunded?: boolean;
  status: string;
}

export function firstNFreeRanks(txs: PromoTxInput[], n = FREE_ORDER_LIMIT): Set<string> {
  const by: Record<string, PromoTxInput[]> = {};
  for (const t of txs) {
    if (!t.expert_id || t.checkup || t.tester || t.fullyRefunded || t.status !== 'paid') continue;
    (by[t.expert_id] ||= []).push(t);
  }
  const out = new Set<string>();
  for (const list of Object.values(by)) {
    list.sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.transaction_id.localeCompare(b.transaction_id));
    list.slice(0, n).forEach((t) => out.add(t.transaction_id));
  }
  return out;
}
