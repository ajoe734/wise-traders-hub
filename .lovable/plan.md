## 三個問題一次修

### ① 匯款不見（延續上一輪）
**根因**：`AppCheckout.tsx` L62 讀的是 `payment_providers` base table，只允許 `company_admin`（RLS 實查確認）；一般會員拿到空陣列，畫面靠舊 bundle 撐出 LINE Pay + ECPay。DB 實際只有 `remittance` + `ecpay`，沒有 line_pay。

**修法**：`src/pages/app/AppCheckout.tsx` L62-66
- table 換成 `payment_providers_safe`（view 已對 authenticated 開放）
- 排序改 `is_default DESC, display_name ASC`
- state 型別加 `is_default?: boolean`；L70-72 校正時優先選 `is_default=true`
- L57 首次 useState fallback 從 `"line_pay"` 改成 `"remittance"`，避免首幀閃到不存在的方式

---

### ② 「24H 內回購保留歷史資料」文案錯誤
**根因**：`src/components/account/RenewalBanner.tsx`。

圖3 的訂閱到期日是 2026/06/22，今天 2026/07/04，**已過期 12 天**，早已超出 24h 窗；但 DB 裡這筆 `status` 仍是 `active`（過期沒被 flip 成 `expired`），所以：
- L47 query `active + expires_at<=now+30d` 分支把它撈進來
- L52-59 client filter：cycle=monthly、days=-12、`days<=7` → 通過
- L72 render：`ms<=0` → `expired=true` → 顯示「已過期 — 24h 內回購保留歷史資料」（文案寫死）

**修法**：`RenewalBanner.tsx`
- L52-59 filter 加一條硬規則：若 `msLeft < -24h` 直接排除（不論 status），也就是「真的超過 24h 回購窗就別再顯示這張紅色 banner」
- L88-91 文案分成三種狀態，避免亂寫 24h：
  - `ms > 0 && days ≤ threshold` → `剩 X 天到期`（琥珀）
  - `ms ≤ 0 && ms > -24h` → `已過期 — 24h 內回購保留歷史資料`（紅）
  - `ms ≤ -24h` 這條配合上面的 filter 根本不會進到 render，安全

實務上圖3 那張 banner 修完後會**直接消失**（因為已 12 天過期，不在任何提醒窗內）。使用者若要續訂，仍可從帳號頁其他入口（訂閱卡片的「立即續訂」）進去，不受影響。

**副作用檢查**：需跑 `e2e/subscription-cancel-renew.spec.ts`（第三個 case 是「過期但 status 仍為 active，10 天內」），確認新規則不會誤殺該情境（10 天 < 24h * X？不，是 10 天前**到期**還是 10 天內**到期**？看測試 baseRoutes `expiresInDays: 10` 是「10 天後到期」→ 未過期 → 不影響）。而 `expiresInDays: -2` 那筆是「2 天前過期」→ 也超過 24h → banner 會消失，但該測試檢查的是續訂連結 href，不是 banner 本身，需仔細比對。若測試依賴 banner，同步調整測試預期。

---

### ③ 匯款訂單建立後跳離，是否會再被提醒？
**現況**：`PendingRemittanceGuard.tsx` **已實作**，登入後掃 `status='awaiting_info'` 的匯款單，用 toast 提示「前往補填」。

**但**目前是 **「每個 session 只提示一次」**（`sessionStorage` dedupe），除非：
- 進了 `/account/remittance`（會清 key，下次進其他頁再提醒）
- 重新登入 / 開新 tab / 關瀏覽器

**使用者的疑問翻譯**：「我建了單，關掉頁面去看訊號，過幾小時回來，還會提醒嗎？」答案**現況是不會**（同一 session 只一次）。

**建議修法**（`PendingRemittanceGuard.tsx`）：
- 把 dedupe 從「一 session 一次」改成「每 N 分鐘一次」— 用 `localStorage` 存 `{userId, lastShownAt}`，`Date.now() - lastShownAt > 30*60*1000` 才再提醒
- 加一個「距建立超過 X 小時仍未補資料」的優先提示（描述改成「您有匯款單建立於 X 小時前，逾期未補將自動關閉」），提高急迫感
- 帳號頁 `/app/account` 已有 `AccountBanner`（獨立於 toast），需確認上面**也**有「未補匯款資料」的常駐紅條（若無則加一條，讓使用者一進帳號頁就看到，不靠 toast 也能發現）

會在實作時先 `rg AccountBanner` 確認是否已有此常駐提示，若已有就不重複加。

---

### 圖2 順帶提到的問題（澄清用，不改）
> 專家方案其實也已經過期，為什麼還是出現在列表上面？

圖2 那筆 `4e88df6a`（2026/05/22 建立、NT$599、狀態「已開通」）**是歷史成功訂單**，訂閱期到 2026/06/22 已過期，但**訂單本身**狀態就是「已開通」永遠不變（訂單是不可變的付款紀錄，不是訂閱）。這頁 (`MyRemittanceOrders`) 是**訂單歷史**列表，不是**有效訂閱**列表，設計上就會顯示所有歷史單。

**要不要改？** 三個選項（先問你）：
- A：維持現狀（歷史單就是要看得到）
- B：把「已開通」但訂閱已過期的單自動摺疊到「歷史訂單」區塊，預設收起
- C：只顯示最近 90 天的單，更舊的收到「查看更多」

我先做 ① ② ③，圖2 這條等你選 A/B/C 再處理。

---

## 驗證

1. ①：Playwright 開 `legendflow.tw/app/checkout/sharkgu/ab1d8e55.../monthly` (restore session)，截圖確認「銀行匯款 + 綠界 ECPay」兩張卡、無 LINE Pay
2. ②：在該帳號打開 `/app/account`，截圖確認紅色「24h」橫幅**消失**（因為已 12 天過期）
3. ③：手動建一筆 `awaiting_info` 匯款單 → 導回首頁 → 應該還是看得到 toast（第一次）；等 31 分鐘（或改成可測的 5 秒門檻）後刷新首頁，應該**再次**看到 toast
4. `bunx vitest run` + `bunx playwright test e2e/subscription-cancel-renew.spec.ts` 全綠
