## 目標
建立一份長效參考文件 `docs/architecture/shell-event-bus-tdd.md`，作為 Shell Event Bus 實作的**唯一事實來源**。之後每次動工前先 `code--view` 這份 doc，避免記憶漂移或重複討論。

## 文件位置與命名
- 路徑：`docs/architecture/shell-event-bus-tdd.md`
- 與既有 `docs/architecture/holdings-modules.md` 同層，方便交叉參照。
- 完成後在 `holdings-modules.md` TODO 區塊加一行 `→ 詳見 shell-event-bus-tdd.md`。

## 文件結構（章節）
1. **背景與非目標** — 為何需要 event bus、本輪不做什麼（legacy 清理、ESLint boundary 另立 PR）。
2. **事件契約** — 初版只有 `holdings:focus { stockCode, source }`；未來事件放 TODO 表格。
3. **檔案清單** — 新增／修改的每個檔案與職責：
   - `src/checkup/shell/eventBus.ts`（純 pub/sub）
   - `src/checkup/shell/ShellEventBusProvider.tsx`（Context + hook）
   - `src/checkup/pages/PortfolioLayout.jsx`（掛 Provider + 註冊 `holdings:focus` listener）
   - `src/checkup/hooks/useRouteHoldingsPage.js`（讀 `?expand=`）
   - `src/checkup/modules/closing/index.ts` / `events/index.ts`（export `useEmitHoldingsFocus`）
   - `src/pages/ShellEventBusHarnessEntry.tsx`（dev/test harness）
4. **TDD 五步節奏** — 每步的紅／綠／重構具體動作與檔案：
   - S1 契約測試 `src/test/unit/shell-event-bus.test.ts`
   - S2 bus 實作
   - S3 Provider + hook 測試 `shell-event-bus-provider.test.tsx`
   - S4 M2/M3 barrel emit helper + 靜態掃描測試（`rg` 驗證沒有跨模組深 import）
   - S5 E2E `e2e/shell-event-bus-navigation.spec.ts`
5. **跨模組互動契約檢查表** — 對應 `holdings-modules.md`「只允許 3 條路」，本 PR 落實第 3 條。
6. **驗收清單** — vitest 全綠、playwright 全綠、`portfolio-modules-smoke` / `module-cross-nav` 不退化。
7. **執行日誌區** — 預留 checkbox 讓每一步完成後我勾選，並記錄 commit / 測試輸出摘要。
8. **後續 TODO** — 事件擴充清單、legacy 清理、ESLint boundary rule。

## 使用約定
- 每次進場先 `code--view docs/architecture/shell-event-bus-tdd.md`。
- 每完成一個 TDD step 立刻更新「執行日誌區」的 checkbox 與測試結果。
- 契約若變動（新增事件、改 payload）先改這份 doc 再改 code。

## 執行順序
1. 批准此計畫後，切 build mode → 只建立這一份 md 檔（本輪不寫任何 code）。
2. 你確認 doc 內容 OK → 我再依 doc 進入 TDD S1（開始寫紅測試）。

## 非目標
- 本 PR 不含實作 code、不含測試檔；只產出 doc。
- 不動 legacy dead code、不加 ESLint rule。
