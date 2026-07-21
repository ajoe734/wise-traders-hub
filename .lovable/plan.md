
## 目標

在週記匯出（前台按鈕與 `weekly-journal-export` Edge Function 兩條路徑）**執行前**加一道守門檢查，若偵測到「單位不一致」或「方向不一致」等高風險資料，**先阻擋匯出**，把問題清單顯示給管理員；管理員檢視後可選擇修資料再匯出，或明確勾選「已確認、強制匯出」放行。

## 風險規則（第一版）

針對送入 `buildJournalExport` 的 `JournalRowExport[]`，以 `expert_id + instrument` 為單位分組計算：

| 代碼 | 名稱 | 判定 | 嚴重度 |
|---|---|---|---|
| `UNIT_MIX` | 單位混用 | 同一 (expert, instrument) 內出現 `quantity_unit` 同時包含 `lot(張)` 與 `share(股)` | block |
| `UNIT_MISSING` | 單位缺失 | 台股/美股訊號 `quantity != null` 但 `quantity_unit` 為空 | block |
| `DIRECTION_NO_ENTRY` | 只賣未買 | 該區間內 (expert, instrument) 只有 `sell/trim/exit`，完全沒有 `buy/add`，且該持倉在 `trade_records` 也查不到開倉紀錄 | block |
| `DIRECTION_OVERSELL` | 賣超 | 匯出範圍內 `sell+trim+exit` 股數合計 > `buy+add` 股數合計 + `trade_records` 期初持倉 | block |
| `QTY_INVALID` | 數量異常 | `quantity <= 0` 或 NaN，但 action 為交易類 | block |
| `PENDING_IN_EXPORT` | 含未發布 | `publishedOnly=true` 卻仍出現 `status != 'published'` 的列（防禦性） | warn |

`warn` 不阻擋、只在對話框列出；`block` 除非管理員勾選強制放行，否則整批不匯出。

## 實作範圍

### 1. `src/lib/journalsExport.ts`（純函式，兩端共用）

新增：

```ts
export type ExportRiskCode =
  | 'UNIT_MIX' | 'UNIT_MISSING'
  | 'DIRECTION_NO_ENTRY' | 'DIRECTION_OVERSELL'
  | 'QTY_INVALID' | 'PENDING_IN_EXPORT';

export interface ExportRiskIssue {
  code: ExportRiskCode;
  severity: 'block' | 'warn';
  expert_id: string;
  expert_name?: string | null;
  instrument: string | null;
  detail: string;              // 中文摘要，例：「賣出 1200 股 > 買進 1000 股」
  rowIds: string[];            // 相關 expert_signals.id
}

export interface ExportRiskReport {
  issues: ExportRiskIssue[];
  blocked: boolean;            // = 任一 issue.severity === 'block'
  summary: { block: number; warn: number };
}

export function detectExportRisks(
  rows: JournalRowExport[],
  ctx?: { openingBalances?: Map<string, number> /* key: expertId::instrument, unit=股 */ },
): ExportRiskReport;
```

`openingBalances` 供 Edge Function 帶入 `trade_records` 期初股數；前端不傳時，`DIRECTION_NO_ENTRY / OVERSELL` 只以本批列為基準判定（會誤報開倉在更早的情況，因此在 UI 訊息中註明「未帶入歷史庫存」）。

單位換算採既有 `張=1000 股` 規則，缺 unit 者不計入方向合計、改由 `UNIT_MISSING` 呈現。

### 2. `src/pages/company/JournalsExport.tsx`

- `doExportMarkdown` 中，`buildJournalExport` 之前先呼叫 `detectExportRisks(scoped)`。
- 若 `report.blocked === true`：**不呼叫 `buildJournalExport`、不下載**，開啟新元件 `<ExportRiskDialog>`（`components/ui/dialog`）：
  - 上方紅色 banner「偵測到 N 項高風險資料，已阻擋匯出」
  - 依老師分組列出 issues：`專家名 · 標的 · code 標籤 · 中文 detail · 相關 signal id`
  - 底部三顆按鈕：`取消` / `複製清單`（JSON 到剪貼簿） / `我已確認、強制匯出`（需先勾 checkbox 才能點）
  - 強制匯出走 `doExportMarkdown({ force: true })` 分支跳過守門。
- 若只有 `warn`：直接匯出，但用 `toast.warning` 顯示「已匯出，另有 N 項提醒」並保留一個「檢視」連結重開 dialog。
- 用 analytics `trackRaw('journal_export_risk_gate', { blocked, block, warn })`。

### 3. `supabase/functions/weekly-journal-export/index.ts`

作為伺服器端最後防線（前端可能被繞過）：

- 抓完 `list` 後、進 `byMentor` 迴圈前，同樣呼叫共用 `detectExportRisks`（把純函式複製或 `import` 到 function 目錄——依既有慣例；此專案 Edge Function 通常內聯，維持一致）。
- 撈 `trade_records` 的期初持倉塞入 `openingBalances`，讓 `DIRECTION_*` 判斷更準。
- 若 `blocked` 且 body 未帶 `force: true`：回 `409 { code: 'EXPORT_BLOCKED', issues, summary }`，**不生檔**。
- 若 body 帶 `force: true` 且呼叫者為管理員：照舊產出，並在回應多帶 `risk_report` 供稽核。
- 寫一筆 `console.warn('[weekly-journal-export] blocked', ...)` 便於日誌追蹤。

### 4. Harness + E2E

- `src/pages/JournalsExportHarnessEntry.tsx` 追加「彥愷 4576 賣超情境」「單位混用情境」兩個 fixture 按鈕，直接餵給頁面 flow，用來驗證 dialog 出現且不下載檔案。
- 新增 `e2e/journals-export-risk-gate.spec.ts`：
  - 案例 1：UNIT_MIX 觸發 → 斷言 dialog 出現、無下載事件、未勾 checkbox 時強制匯出鈕 disabled。
  - 案例 2：勾 checkbox 後點強制匯出 → 產生 `.md` 下載、`journal_export_risk_gate` 事件 payload 含 `force: true`。
  - 案例 3：只含 `warn` → 直接下載但 toast 出現「另有提醒」。
- 註冊為新的 Playwright project `desktop-journals-export-risk-gate`。

### 5. 不動的事

- 不改資料表結構、不改既有 signal 提交流程（單位鎖定另案處理）。
- 不改 `buildMentorMarkdown` 輸出格式。
- 不對 `trade_records` 做任何修補；守門只是唯讀檢查。

## 檔案清單

- 修改：`src/lib/journalsExport.ts`
- 修改：`src/pages/company/JournalsExport.tsx`
- 新增：`src/components/company/ExportRiskDialog.tsx`
- 修改：`supabase/functions/weekly-journal-export/index.ts`
- 修改：`src/pages/JournalsExportHarnessEntry.tsx`
- 新增：`e2e/journals-export-risk-gate.spec.ts`
- 修改：`playwright.config.ts`（加 project）

## 驗收

1. 用彥愷 4576 fixture 走前台匯出 → 應被擋、dialog 列出 `UNIT_MIX` 與 `DIRECTION_*`（若有）。
2. 呼叫 `weekly-journal-export`（無 `force`）→ 回 409、無檔案產生。
3. `force: true` 再呼叫 → 產出檔且回應含 `risk_report`。
4. 乾淨資料（如 benny 空持倉）匯出流程完全不變。
5. 新 Playwright project 全綠。
