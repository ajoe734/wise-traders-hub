
## 目標

驗證上一輪實作的兩條新路徑，符合既有 Group 1.x 測試的「pure function + drift-detection + Playwright UI」三層風格。

## 範圍

只新增測試檔，不改任何產品代碼。若測試跑出真實 bug 才回來修。

---

## 1. 新增 `src/test/integration/1.36-teaching-hold-journal.test.ts`

**A. derive.ts 純函數驗證（buildTeachingOnlyRow / buildSignalRows）**

- 純教學：呼叫 `buildTeachingOnlyRow({ teachingTopic: '本週主題X', ... })` → 回傳剛好 1 筆 row，`action='teaching'`、`instrument=''`、`price_hint/quantity/quantity_unit` 皆為 null、`teaching_topic` 正確帶入、`status='pending'`（mentor）。
- 純教學：`teachingTopic` 空字串 → `teaching_topic` 為 null（驗證 fallback）。
- hold 分支：`buildSignalRows` 帶一筆 `action='hold'` 的 trade → row 正確輸出 action='hold'、`teaching_topic` 只掛在第 0 筆、不會被 `derive` 過濾掉。
- hold action 在「derive 持倉模擬」中被略過（`if (t.action === 'hold') continue;` 第 204 行行為）→ 不會產生新增持倉。

**B. publish-weekly-journals drift-detection**

讀 `supabase/functions/publish-weekly-journals/index.ts` 字串，斷言：
- 含 `'teaching'` 與 `'hold'` 分支關鍵字
- `teaching`/`hold` 分支不會呼叫 `trade_signals` insert / `user_performances` upsert（用 regex 確認兩個 action 的程式碼區塊內沒有對應字串）
- `expert_signals` 仍由 pending → published（既有行為不被破壞）

**C. SignalEditor canPublish 邏輯**

把 `isTeachingOnly && !teachingTopic.trim()` 的擋下邏輯抽成驗證：drift-check `src/pages/admin/SignalEditor.tsx` 含關鍵字 `isTeachingOnly`、`teachingTopic.trim()`、`weekType === 'teaching'` 三段，避免日後 UI 重構誤刪。

---

## 2. 新增 `e2e/mentor-teaching-journal.spec.ts`（Playwright UI 層）

採用既有 `e2e/helpers` 登入流程（mentor 帳號）。流程：

1. 進 `/admin/signals/new`（或既有 SignalEditor 入口）
2. 點「純教學週記」切換鈕 → 斷言交易欄位區塊消失、`teaching_topic` 輸入框出現
3. 留空送出 → 斷言出現「請填寫教學主題」類錯誤
4. 填入 `本週主題 — E2E 測試 ${timestamp}` → 送出
5. 斷言成功 toast / 跳轉，且後續清單頁可見該筆，狀態為 pending
6. 切回交易週記模式 → 新增一筆 `hold` action（用既有持倉股票）→ quantity/price 留空可送出
7. 斷言該筆 hold 出現在清單，badge 顯示「觀察」

**清理**：測試尾端用 service role 刪除剛建立的 `expert_signals` 兩筆，避免污染。

**前置條件**：需要既有測試 mentor 帳號至少有一檔開倉持倉。若 helpers 沒有，沿用 `e2e/helpers` 的 fixture 模式新增 `ensureMentorHasOpenPosition()`。

---

## 3. 不做

- 不真實打 publish-weekly-journals edge function（pending → published 已由 1.18 cover；teaching/hold 透過 drift 保護即可，避免在測試中觸發週五排程副作用）
- 不改 derive.ts / SignalEditor / publish-weekly-journals 任何產品邏輯
- 不動 advisor 路徑（advisor 沒有 teaching/hold）

---

## 驗收

1. `bunx vitest run src/test/integration/1.36-teaching-hold-journal.test.ts` 全綠
2. `bunx playwright test e2e/mentor-teaching-journal.spec.ts` 全綠
3. 既有 `1.16-signal-trade-trigger` / `1.18-weekly-publish-rls` 不破

跑完後回報每個案子的結果。若 Playwright 因 mentor fixture 缺持倉而需要先 seed，會在 build 階段把 seed helper 一併補上。
