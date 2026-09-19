# 券商分點資料可見性設定

讓你在後台決定籌碼資料的各個區塊要不要顯示、以及資料落後幾天之後該怎麼處理，避免畫面出現空白區塊。

## 你會看到什麼

**後台新增「籌碼資料顯示設定」（放在券商分點回補進度頁最上方）**

一張設定卡，四個區塊各一列開關：

- 三大法人
- 券商分點（買賣超前三名）
- 融資融券／借券（若該區塊有資料）
- 分點明細抽屜

每列可設定：

| 設定 | 說明 |
| --- | --- |
| 顯示 | 開／關。關閉時該區塊在前台與管理頁都不出現 |
| 落後容忍天數 | 預設 3 個交易日 |
| 超過容忍時 | 「照常顯示並標註資料截至日」（預設）或「整塊隱藏」 |

卡片底部即時顯示每個區塊目前的實際資料日期與落後天數，讓你調設定時看得到後果。

**前台持倉看板**

- 關閉或判定隱藏的區塊：整塊不渲染，不留空框。
- 判定顯示但已落後：照現行文案標註「資料截至 YYYY/MM/DD」，沿用既有的更新暫停說明，不改語氣、不揭露上游名稱。
- 全部區塊都被隱藏時，籌碼區只留一行簡短說明，不出現空白卡。

預設值等同現在的行為，套用後畫面不會突然改變，除非你動設定。

## 技術細節

- 新表 `chips_visibility_settings`（single-row 或以 `section_key` 為主鍵）：`section_key`、`visible`、`stale_tolerance_days`、`stale_behavior`（`annotate` / `hide`）、`updated_by`、`updated_at`。建表同一 migration 附 GRANT：`anon`/`authenticated` 只給 SELECT，寫入僅 `company_admin`（`has_role`）與 `service_role`；啟用 RLS。
- 純函式新模組 `src/checkup/lib/chipsVisibility.ts`：輸入（設定列、該區塊 as_of、今日交易日）→ 輸出 `{ render: boolean; annotate: boolean; asOfLabel: string | null }`。這是唯一決策點，元件不得自刻落後判斷。
- `ChipsSection.tsx` 與 `chipsFreshnessSegments.ts` 只消費該函式結果；既有 `bsrProviderPresentation` 的 terminal／transient 文案規則不動，隱藏判定疊在其上（隱藏優先）。
- 設定以 React Query 讀取並快取，失敗時 fallback 為「全部顯示 + annotate」，不因設定讀取失敗而讓畫面空白。
- 後台設定卡放進 `src/pages/company/BsrBackfillProgress.tsx`，寫入走既有 supabase client，無需新 edge function。
- 測試：`chipsVisibility` 單元測試涵蓋四區塊 ×（開/關）×（未落後/落後 annotate/落後 hide）×（無資料）全組合；`ChipsSection` 整合測試斷言隱藏時不渲染對應 `data-testid`、annotate 時出現資料截至日；管理頁測試涵蓋儲存成功／權限不足／讀取失敗 fallback。最後跑 tsgo、module-boundaries、build。
