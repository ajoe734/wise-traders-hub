

# 補強測試覆蓋計畫

## 目標

針對目前測試套件的三大缺口進行補強：(1) 前端表單驗證、(2) 純函式單元測試、(3) 關鍵 UI 元件渲染測試。

## 範圍與檔案

### 1. 前端表單驗證測試（最高優先）

新增 4 個測試檔，驗證上一輪實作的 inline validation 不會回歸。

| 測試檔 | 對應元件 | 涵蓋情境 |
|--------|---------|----------|
| `src/test/components/Login.test.tsx` | `pages/auth/Login.tsx` | 空 Email/密碼顯示紅框與錯誤文字；輸入後錯誤清除；驗證通過才呼叫 `login()` |
| `src/test/components/Register.test.tsx` | `pages/auth/Register.tsx` | 姓名/Email/密碼 ≥8 字/密碼一致性；onChange 清除；阻擋送出 |
| `src/test/components/Checkout.test.tsx` | `pages/Checkout.tsx` | ACpay 持卡人三欄位（英文姓名 / Email 格式 / 9-10 碼電話）驗證；按下「確認付款」時阻擋送出 |
| `src/test/components/AppCheckout.test.tsx` | `pages/app/AppCheckout.tsx` | 同上，且驗證已不再呼叫 `alert()` |

每個檔案約 4–6 個 `it()` 案例，使用既有 `renderWithProviders` 並 mock `useAuth` / `supabase.functions.invoke`。

### 2. 純函式單元測試

補齊 `src/lib` 中尚未測試的關鍵商業邏輯：

| 測試檔 | 對應模組 | 重點 |
|--------|---------|------|
| `src/test/unit/1.25-leaderboard-calc.test.ts` | `lib/leaderboardCalc.ts` | 漲停王精確比對、排序、平手規則 |
| `src/test/unit/1.26-scheduler-calc.test.ts` | `lib/schedulerCalc.ts` | 週年扣款時間推算、閏年邊界 |
| `src/test/unit/1.27-signal-trade-logic.test.ts` | `lib/signalTradeLogic.ts` | UI→system action 對應（buy/add/trim/sell/exit）、加碼數量驗證 |
| `src/test/unit/1.28-refund-calc.test.ts` | `lib/refundCalc.ts` | 年繳剩餘月數計算、月繳不予退費 |
| `src/test/unit/1.29-publishing-window.test.ts` | `lib/publishingWindow.ts` | 台股交易時段（週一–五 08:00–20:00 UTC+8） |

### 3. 關鍵 UI 元件渲染煙霧測試

| 測試檔 | 對應元件 | 重點 |
|--------|---------|------|
| `src/test/components/ProtectedRoute.test.tsx` | `components/ProtectedRoute.tsx` | 未登入導向 `/auth/login`、保留 `from` state |
| `src/test/components/RoleBadge.test.tsx` | `components/RoleBadge.tsx` | Mentor 顯示藍色、Advisor 顯示主色 |
| `src/test/components/WeeklyLimitUpLeaderboard.test.tsx` | `components/WeeklyLimitUpLeaderboard.tsx` | 空資料 / 有資料兩種狀態 |

## 技術細節

- **框架**：沿用既有 Vitest 3.x + jsdom + React Testing Library，不引入新依賴
- **共用工具**：所有元件測試使用 `src/test/utils/renderWithProviders.tsx` 包裝 `QueryClient` + `MemoryRouter`
- **Mock 策略**：
  - Supabase：沿用 `src/test/mocks/supabase.ts` 的 `createMockSupabase()`
  - `useAuth`：以 `vi.mock('@/contexts/AuthContext')` 注入假的 `login` / `user` / `hasRole`
  - `useToast`、`useNavigate`：以 `vi.fn()` 監看呼叫，確保驗證失敗時不觸發
- **斷言重點**：紅框 class（`border-destructive`）、錯誤文字、`login`/`invoke` 是否被呼叫
- **CI**：既有 `.github/workflows/test.yml` 會自動納入新檔（glob `src/**/*.test.{ts,tsx}`）

## 不在範圍內

- E2E（Playwright/Cypress）—需另起框架，本輪不引入
- Edge Function 真實呼叫測試—維持 mock 策略
- `src/checkup/**` 模組—屬獨立子應用，另案處理

## 預期成果

- 新增 12 個測試檔，約 60–80 個測試案例
- 覆蓋率：前端表單 0% → ~90%；`src/lib` 純函式由 3 模組擴充至 8 模組
- 表單驗證 UX 受 CI 守護，未來修改若破壞 inline 驗證會立即失敗

