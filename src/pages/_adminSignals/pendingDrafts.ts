/**
 * 待發布（pending）週記草稿彙總 — 單一資料源。
 *
 * 「一篇週記 = 一個 batch_id」。列表頁把 pending 的 expert_signals 依批次
 * 聚合成一張可以「繼續編輯」的草稿卡片。純函式，方便單測。
 */

import { htmlToPlainText } from '@/lib/sanitizeHtml';

export interface PendingDraft {
  batchId: string;
  /** 這篇週記的標題（教學主題優先，否則用檔數摘要） */
  title: string;
  /** 交易檔數（純教學週記為 0） */
  tradeCount: number;
  instruments: string[];
  /** 該批次最後一次寫入時間（ISO） */
  lastSavedAt: string | null;
  isTeachingOnly: boolean;
}

const pickLatest = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
};

export function computePendingDrafts(signals: any[]): PendingDraft[] {
  const byBatch = new Map<string, any[]>();
  for (const s of signals || []) {
    if (s?.status !== 'pending') continue;
    const key = s.batch_id || `__single__${s.id}`;
    const list = byBatch.get(key);
    if (list) list.push(s);
    else byBatch.set(key, [s]);
  }

  const drafts: PendingDraft[] = [];
  for (const [key, rows] of byBatch) {
    const batchId = rows[0]?.batch_id || null;
    if (!batchId) continue; // 無批次的舊資料無法用批次編輯入口
    const tradeRows = rows.filter((r) => r.action !== 'teaching');
    const isTeachingOnly = tradeRows.length === 0;
    const topic = rows.map((r) => r.teaching_topic).find((t) => !!t && String(t).trim()) || '';
    const summary = rows.map((r) => r.overall_summary).find((t) => !!t && String(t).trim()) || '';
    const instruments = tradeRows
      .map((r) => String(r.instrument || '').trim())
      .filter(Boolean);

    const fallback = isTeachingOnly
      ? (htmlToPlainText(summary).trim().slice(0, 40) || '純教學週記')
      : `${instruments.length} 檔操作`;

    let lastSavedAt: string | null = null;
    for (const r of rows) {
      lastSavedAt = pickLatest(lastSavedAt, r.published_at || r.created_at || null);
    }

    drafts.push({
      batchId,
      title: topic.trim() || fallback,
      tradeCount: instruments.length,
      instruments,
      lastSavedAt,
      isTeachingOnly,
    });
    void key;
  }

  return drafts.sort((a, b) => (b.lastSavedAt || '').localeCompare(a.lastSavedAt || ''));
}
