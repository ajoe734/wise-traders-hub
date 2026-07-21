## 目標
對全站進行**一次性**資料一致性審計，確認三個口徑完全一致：

| 口徑 | 來源 |
|------|------|
| A. 交易帳本 | `trade_records`（open + closed，含 shares、entry/exit price） |
| B. 已發布訊號流水 | `expert_signals` where `status='published'`（buy/add/trim/exit/sell） |
| C. 週記匯出口徑 | `src/lib/journalsExport.ts` 的 `buyTotals` / `sellTotals` / row 明細（實際跑 `buildMentorMarkdown`） |

彥愷 4576 事件證明這三者有機會漂移（trade_records 單位錯亂、pending trim 沒發布卻被誤讀），需要一次全量對帳把所有漂移抓出來、逐筆處理。

## 交付物
1. **一次性審計腳本** `scripts/audit/holdings-consistency.ts`（Deno / tsx，直接連 DB read-only）
   - 不改 schema、不寫任何資料
   - 產出 `/mnt/documents/holdings-consistency-YYYYMMDD.md` 報表
2. **報表區塊**（每位 expert × instrument 一列）
   - `A_open_shares`：trade_records 未平倉股數（換算成股）
   - `B_signal_net_shares`：expert_signals published 的 buy+add − sell−trim−exit（按 unit 換算成股）
   - `C_export_buy` / `C_export_sell`：把該老師近 90 天 signals 丟進 `buildMentorMarkdown`，parse 出「本週總計」相同口徑
   - `unit_mix`：該 instrument 是否同時出現「張」與「股」
   - `pending_orphan`：`status='pending'` 但已超過 7 天未發布的訊號（彥愷案主兇）
   - `status`：`OK` / `DRIFT_A_vs_B` / `DRIFT_B_vs_C` / `UNIT_MIX` / `ORPHAN_PENDING`
3. **摘要**
   - 全站 DRIFT 總數、按老師分組 top 10
   - 明列所有非 OK 的 `(expert_slug, instrument, 差異股數, 建議動作)`
4. **後續處置清單**
   - DRIFT_A_vs_B → 需 SQL 修 trade_records 或補發訊號（人工判斷）
   - UNIT_MIX → 標記需老師確認
   - ORPHAN_PENDING → 提供一鍵刪除 SQL 清單（不自動執行）

## 演算法要點

```text
換算：1 張 = 1000 股（僅台股，us_stock/crypto 一律以 shares 為主）
A_open_shares  = Σ trade_records where status='open' → shares
B_signal_net   = Σ (buy+add)·qty·unitFactor − Σ (sell+trim+exit)·qty·unitFactor
                 只計 status='published'
C_export       = 對該 expert 所有 published signals 執行 buildMentorMarkdown，
                 再用同一個 parser 抓「總買進股數 / 總賣出股數」
判定：
  |A_open − (B_buy − B_sell)| > 0        → DRIFT_A_vs_B
  |B_buy − C_export_buy| > 0             → DRIFT_B_vs_C   (代表匯出 logic 漏了某類 action)
  該 instrument 同時出現張/股 unit        → UNIT_MIX
  status='pending' AND created_at < now()-7d → ORPHAN_PENDING
```

## 不做的事
- 不新增 UI、不新增 cron、不改 schema、不改業務邏輯
- 不自動修資料，只產出報表 + 建議 SQL；每一筆 drift 需人工確認再處理
- 不動 checkup 端持倉（本次僅針對分析師 expert 端）

## 技術細節
- 讀取層：`@supabase/supabase-js` service role（走本地 `PGHOST` psql 或 supabase read_query 皆可）
- 單位換算集中在 `src/lib/journalsExport.ts` 現有 `normalizeUnit` / 換算表，審計腳本 import 同一份避免二次口徑
- Parser 重用 `journals-export-weekly-totals` 系列 e2e 用的 regex，直接 import 抽出的 helper（若沒抽出，順手抽到 `src/lib/journalsExport.ts` export）
- Cross-check 一律 dry-run，報表寫入 `/mnt/documents/`，方便下載

## 執行流程
1. 抽出 / 匯出 `parseWeeklyTotals` helper（若尚未 exported）
2. 建立 `scripts/audit/holdings-consistency.ts`
3. 執行一次，產出 markdown 報表
4. 回報：全站 DRIFT 總覽 + 明細清單 + 每筆建議動作
5. 由你確認哪些要修，再逐筆 supabase--insert / migration 處理（不在本次計畫內）
