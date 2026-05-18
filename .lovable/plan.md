
# 第二輪優化計劃

第一輪已完成 C5（routePrefetch 節流）、D2（Context 審視）、P1-Checkout 第一刀（Consent Dialog，1351 → 1121 行）。本輪繼續，仍維持「每輪 3–4 個小步驟、驗收明確」的節奏。

---

## 步驟 1 — P1-Checkout 收尾（1121 → 目標 ≤ 700 行）

`src/pages/Checkout.tsx` 仍有 1121 行，再抽 3 塊：

- `_checkout/PlanSummaryCard.tsx` — 方案資訊卡（標題、價格、週期切換、跨產品折扣顯示）
- `_checkout/PaymentMethodPicker.tsx` — 付款方式選擇區（ECPay / ACpay / 匯款）含對應說明
- `_checkout/useCheckoutSubmit.ts` — 把 submit flow（驗證 → 建單 → 導轉）抽成 hook

驗收：Checkout.tsx ≤ 700 行；現有測試 `src/test/components/AppCheckout.test.tsx`、`1.5-payment-subscription-atomicity` 維持綠燈；手動跑一次 ECPay / ACpay / 匯款三條路徑（preview 點擊）。

## 步驟 2 — P1-Pricing 拆分（1028 → 目標 ≤ 600 行）

`src/pages/Pricing.tsx` 抽：

- `_pricing/PlanCard.tsx` — 單一方案卡（價格、特色列、CTA）
- `_pricing/ComparisonTable.tsx` — 方案比較表
- `_pricing/PricingFaq.tsx` — FAQ 區

容器保留 SEO / hero / data 組裝。驗收：Pricing.tsx ≤ 600 行；視覺截圖比對 lg/md/sm 三斷點無位移。

## 步驟 3 — Edge 共用層遷移（低風險批，3 個 function）

從唯讀類挑 3 個 ROI 最高、流量最大的試水：

1. `checkup-calendar`
2. `checkup-predict-events`
3. `checkup-sparkline`

每個改造內容：
- 刪除 inline `corsHeaders` → import `_shared/cors.ts`
- 刪除 inline `createClient(...)` → 用 `serviceClient()` 或 `userClient(req)`
- handler 包 `withLogging('fn-name', ...)`，`console.log/error` → `log.info/error`
- 預期每個 function 減 ~30 行 boilerplate，並自動產生 `requestId` + duration log

驗收：3 個 function 部署成功；用 `supabase--curl_edge_functions` 各打一次驗 happy path；`/company/function-logs` 看得到 JSON 結構化 log + requestId。

---

## 技術細節

- **不動的東西**：FreeCheckup（已收尾）、`<style>` 字面字串、AuthContext 拆分、constants.jsx `getCurrentUserId()` 合約。
- **不動金流批**：ecpay-callback / acpay-* / process-refund 留到最後一輪，需配 happy-path test 後再動。
- **檔案合約**：抽出的子元件 props 用 explicit interface，不偷懶用 `any`；hook 回傳值以 `useMemo`/`useCallback` 包好避免 cascade re-render。
- **回滾策略**：每步驟獨立 commit，若 e2e 失敗只回滾該步。

---

## 順序與時間估算

| 步驟 | 預估 | 風險 |
|---|---|---|
| 1. Checkout 收尾 | 中 | 低（純拆分，邏輯不動） |
| 2. Pricing 拆分 | 中 | 極低（純展示頁） |
| 3. Edge 3 fn 遷移 | 小 | 低（唯讀類，骨架已驗證過 knowledge-backtest） |

完成後 Checkout/Pricing 進入可維護區間，Edge 共用層證明 pattern 可用，第三輪可放心擴大到 Index/Signals 與背景排程批。

要按此順序開工嗎？或想調整哪一步？
