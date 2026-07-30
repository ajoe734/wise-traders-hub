/**
 * JournalDetail 深模組：型別契約。
 * 週記詳情頁與其子元件共用的訊號形狀（來自 journalRepository 的 JOURNAL_DETAIL_SELECT）。
 */
export interface SignalDetail {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string | null;
  currency?: string | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string;
  expert_id: string;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    currency?: string | null;
    asset_class?: string | null;
  };
}
