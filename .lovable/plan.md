# 收款帳號沒有被刪除 — 是權限閘門擋掉了

## 事實查證（production 唯讀）

- `payment_settings` 的 `remittance_account` 仍在：永豐銀行 807 / 海洋福星生物科技股份有限公司 / 帳號末碼 …1338，`updated_at` 停在 2026-05-22，之後沒有任何變更。**沒有人刪它。**
- 畫面上「收款帳號尚未設定，請聯絡客服」是 `RemittanceAccountCard` 在 `get_remittance_account()` 回傳 NULL 時的 fallback 文案。
- `get_remittance_account()` 只在下列情況回傳資料：
  - 使用者有訂單且 status ∈ (`pending`, `awaiting_confirmation`, `submitted`, `awaiting_payment`)，或
  - 使用者是 `company_admin`。
- 但 `remittance_orders` 實際只用三種 status：`awaiting_info`、`confirmed`、`expired`。**`awaiting_info` 不在白名單裡**，所以任何等待補匯款資料的會員一律看不到收款帳號。
- 更嚴重的是結帳頁（`/checkout`、`AppCheckout`、`CheckupCheckout`）在「建立訂單之前」就渲染這張卡，此時使用者根本沒有任何訂單 → 必定 NULL → 必定顯示「尚未設定」。

## 修正方案

1. 修 `get_remittance_account()` 的閘門（migration，只改函式本體，signature/SECDEF/search_path 不動）：
   - 把 status 白名單改成實際會用到的值，補上 `awaiting_info`（保留舊值以防歷史資料）。
   - 加上「已登入使用者即可讀」的條件，讓結帳頁在下單前也能顯示收款帳號。這是公司自己的對外收款帳戶，本來就要印在結帳頁與匯款指示上；仍保留 `auth.uid() IS NULL` 回傳 NULL，未登入者看不到。
2. 前端不動邏輯，只把 fallback 文案調整為區分「未登入」與「真的未設定」，避免再誤導成資料被刪。

## 技術細節

- 新 migration：`CREATE OR REPLACE FUNCTION public.get_remittance_account()`，維持 `RETURNS jsonb / STABLE / SECURITY DEFINER / SET search_path = public`，不新增 GRANT（既有 ACL 不變）。
- 驗收：以匿名、一般已登入會員（有 `awaiting_info` 訂單）、一般已登入會員（無訂單）、`company_admin` 四種身分讀 RPC，前者 NULL、後三者回傳完整帳號 JSON。
- 不動 `payment_settings` 任何資料列。
