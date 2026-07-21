## 目標
建立一套「窮舉式」bug 掃描 → 根因分類 → 一次收斂修法 → 回歸鎖死的流程，把持倉看板（HoldingsPanel / HoldingsTable / HoldingsWorkbench / HoldingsDetailPanel / HoldingMetaReportModal / ChipsSection）殘留的所有 bug 一次清光，並用測試防止復發。不再挑一兩個樣本交差。

## 範圍（強制窮舉）

**前端元件（8 個）**
- `HoldingsPanel.tsx`、`HoldingsTable.jsx`、`HoldingsWorkbench.tsx`
- `HoldingsDetailPanel.tsx`、`HoldingMetaReportModal.tsx`、`ChipsSection.tsx`
- `TargetPriceHistorySection.tsx`、`HoldingsIntroVideo.jsx`

**Hook / 資料源（單一資料源憲法）**
- `useExpertHoldingsBundle`（capital / openPositions / total_return / avg_pnl 唯一入口）
- `useHoldingsSync`、`useHoldingMetaOverrides`、`useTargetPriceHistory`
- 相關 RPC：`get_expert_holdings_bundle`、`admin_holdings_*`

**Edge Functions（8 支）**
- `tw-bsr-finmind-sync`、`tw-bsr-worker-tier1-catchup`、`tw-bsr-worker-trading`、`tw-institutional-daily-sync`
- `checkup-price-refresh`、`holdings-meta-override`、`holdings-fix-proposal-*`
- `publish-weekly-journals`（透過持倉帶入邏輯）

**DB / 資料表**
- `trade_records`、`holding_meta_overrides`、`holding_meta_override_history`、`holdings_fix_proposals`
- `tw_bsr_daily`、`tw_chips_rollup`、`tw_institutional_daily`、`current_prices`、`daily_price_snapshots`
- `target_price_history`、`checkup_trade_memos`

**E2E（34 支現有）**：必須逐支跑一次，統計 pass/fail/flaky，不能只挑通過的展示。

---

## 執行步驟

### Phase 1 — 窮舉掃描（唯讀，產出 bug 清單）

1. **靜態掃描**
   - 硬編碼單位/顏色/字級：`grep -rn "張\|#\|fontSize.*[0-9]{2,}"` in holdings 目錄
   - 憲法違反：任何直接讀 `trade_records` 取持倉、任何跳過 `useEffectiveUserId`、任何 alpha hex 未走 tokens、任何 `expert_signals.currency` 殘留
   - 資料源分裂：搜 `.from('trade_records')` / `.rpc('get_expert_holdings` 交叉比對
   - `<style>` fontSize ≥ 32 缺 media query 的清單（違反 Core 規則）

2. **Runtime 掃描**
   - 跑滿 34 支 E2E（含 visual snapshot），輸出 `drawer-extreme-html-reporter` 完整報告
   - Playwright 手動走 4 條路徑（TW/US/Crypto/US Future）× 3 斷點（380/560/1280）× 4 動作（開抽屜/切標的/編 override/滾動到底）截圖
   - 讀 dev-server log + supabase edge function logs（近 24 小時錯誤）

3. **DB 深掃**
   - `trade_records` 單位漂移：us_stock 出現「張」、tw_stock 出現「股」、crypto 非「顆」、future 非「口」
   - `holding_meta_overrides` orphan（對應 signal 已刪）、重複 (user_id, symbol) 未清
   - `target_price_history` target=0 是否正確保留（不能被當 null 過濾）
   - `tw_bsr_daily` / `tw_chips_rollup` 對熱門持倉的新鮮度缺口
   - `notifications` 內部連結是否仍有殘存絕對 URL

4. **輸出**：`/tmp/holdings-audit/bug-list.md`，每筆含 `檔案:行號 / 症狀 / 重現步驟 / 根因假設 / 影響面`。回報前自問「這份清單漏了什麼」，補到窮舉為止。

### Phase 2 — 根因分類

依症狀→根因歸類（不修表象）：
1. **資料源分裂**（違反 expert holdings 單一資料源憲法）
2. **單位/幣別漂移**（憲法：由 asset_class 推導，禁止字面 fallback）
3. **RWD 溢出**（fontSize / grid / overflow-x / dvh 缺失）
4. **滾動陷阱**（sheet.tsx / Workbench visibility-key useEffect / dvh）
5. **快取與同步**（React Query invalidate 缺、realtime 未 reset、backoff 錯）
6. **RLS / 權限**（view-as、owner 讀不到自己資料、trigger service_role bypass）
7. **邊界值**（target=0、quantity=0、賣超、資金爆表）
8. **可觀測性缺口**（分點抓取失敗未 surface、override 衝突未告警）

### Phase 3 — 收斂修法（同類一次修完）

- 每一類**修「類別」不修「個案」**：找同分類的所有姊妹路徑一次改。
- 每個修法必須帶：
  - 對應回歸測試（unit / integration / e2e 至少一層）
  - Playwright 視覺快照更新（若涉 UI）
  - 憲法備忘更新（若動到單一資料源、單位、色票、字級）

### Phase 4 — 驗證（不准偷懶）

1. 34 支 E2E 全綠 + 新增測試全綠
2. `tsgo` 全綠、`bunx vitest run` 全綠
3. 4×3×4 = 48 個手動情境 Playwright 截圖存檔於 `/mnt/documents/holdings-audit/`
4. DB 深掃 SQL 二次執行，確認 0 筆漂移
5. Edge function logs 24h 無新錯誤類別
6. 回報格式：**bug 清單全表** + **每筆 before/after** + **測試覆蓋對照表**，缺一補完再回

---

## 交付物
- `/tmp/holdings-audit/bug-list.md`（Phase 1 產出）
- `/tmp/holdings-audit/root-cause-matrix.md`（Phase 2 分類）
- 一次性 PR 合輯：程式碼修法 + migrations + 測試 + 快照
- `mem://qa/holdings/holdings-board-full-audit-2026-07` 記錄本輪掃描邊界與新增憲法

## 需要你確認
1. **範圍是否要納入「後台週記撰寫→持倉帶入」那條線**（跨 `SignalEditor` / `publish-weekly-journals`）？我建議納入，因為 benny/彥愷案例都源自那裡。
2. **是否允許我在 Phase 1 直接跑 34 支 E2E**（會消耗較多時間，但唯讀）？
3. **視覺快照是否要重新 baseline**（若舊 baseline 已含 bug 狀態，會遮蔽問題）？
