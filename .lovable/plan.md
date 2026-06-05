# GTM dataLayer 廣告事件埋設計畫

GTM 容器（`GTM-PBH8J4VD`）已在 `index.html` 載入，目前只在兩個結帳頁推 `Purchase`。內部分析已有 `src/lib/analytics/events.ts`（走 trafficTracker），但**廣告 / 媒體投放追蹤需要的是 GTM dataLayer**——兩者目的不同，需並行不取代。

## 一、建立統一推送工具

新增 `src/lib/analytics/gtm.ts`：

```ts
export function gtmPush(event: string, params: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  (window as any).dataLayer = (window as any).dataLayer || [];
  (window as any).dataLayer.push({ event, ...params });
}
```

理由：避免每個檔案重寫 `window.dataLayer.push`、方便日後加 `user_id` hash / consent 判斷 / debug。

## 二、要埋的關鍵節點（漏斗順序）

| # | 事件名 | 觸發點（檔案） | 主要參數 |
|---|---|---|---|
| 1 | `Login` | `AuthContext.login` 成功後、`LineCallback` 兌換成功後 | `method: 'email' \| 'line'` |
| 2 | `SignUp` | `AuthContext.register` 成功後 | `method: 'email'` |
| 3 | `Function`（你提的「使用功能」） | 進入 `/app`、`/checkup`、`/app/research` 等首次互動 | `feature: 'checkup' \| 'app' \| 'research' \| 'log'` |
| 4 | `ViewExpert` | `ExpertProfile` mount | `expert_slug` |
| 5 | `ViewPricing` | `Pricing` / `CheckupCheckout` 頁載入 | `plan_id?` |
| 6 | `BeginCheckout` | `Checkout` / `CheckupCheckout` 點「確認付款」當下 | `plan_id, amount, method` |
| 7 | `Purchase` ✅ 已有 | 付款回呼成功頁 | 補上 `value, currency:'TWD', plan_id, transaction_id` |
| 8 | `SubscribeExpertClick` | 專家頁訂閱 CTA | `expert_slug, plan_id?` |
| 9 | `LineBindStart` / `LineBindSuccess` | LINE 綁定按鈕 / webhook callback 回前端 | `expert_slug?` |
| 10 | `CheckupAnalysisRun` | 收盤分析 / 個股研究 / 深度研究 / 事件預測 成功回應 | `kind: 'daily' \| 'stock' \| 'deep' \| 'predict'` |
| 11 | `QuotaBlocked` | 額度耗盡 toast 顯示時 | `kind, reason` |
| 12 | `UpgradeClick` | 任何「升級 / 解鎖」CTA | `from` |

> 1、6、7 是廣告（Meta / Google Ads）最常用的轉換事件；其他屬於再行銷與漏斗分析。

## 三、與內部 analytics 的關係

- 內部 `track()`（`src/lib/analytics/events.ts`）→ 寫入自家 `traffic_events` 資料表。
- GTM `gtmPush()` → 送給 Meta / Google Ads / GA4。
- **同一個關鍵節點同時呼叫兩者**，由統一 helper 包起來（例如 `trackConversion('login', {...})` 內部一次推兩邊），避免日後遺漏。

## 四、Consent / 隱私

- 在 `gtmPush` 內檢查使用者是否已接受 cookie consent（目前專案若無 CMP，預設全部送出；之後加 CMP 只要改一個地方）。
- 不送 PII：`user_id` 若要附帶，用 SHA-256 hash。

## 五、QA

- 用 GTM Preview 模式 + Tag Assistant 一次走完 12 個事件。
- 加 `src/test/unit/gtm-events.test.ts`：mock `window.dataLayer`，驗證每個 helper 呼叫後 push 的 payload schema。

## 六、實作順序

1. 建 `gtm.ts` + 單元測試
2. 補 Login / SignUp / Function（3 個最高優先）
3. 強化既有 Purchase（補 value / transaction_id）+ 新增 BeginCheckout
4. 其餘節點（Expert / Checkup / Quota）
5. 文件：新增 `docs/gtm-events.md` 列出事件字典給行銷團隊在 GTM 設 Trigger

---

請確認：
- 事件名稱要用你給的 `Login` / `Function` 這種 PascalCase？還是改 GA4 慣例的 `login` / `sign_up` / `begin_checkout` / `purchase`（推薦，GTM 內建範本可直接用）？
- 第 7 點 Purchase 是否要帶金額與 transaction_id（Meta Conversions API / GA4 ecommerce 需要）？
- 是否需要同時送 Meta Pixel / GA4 `gtag`，還是全部交給 GTM 在容器內分流？
