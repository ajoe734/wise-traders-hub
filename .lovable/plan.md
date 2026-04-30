## 目標

1. 後台 `/company/payments` 可以直接編輯**綠界金流金鑰**（商店代號、HashKey、HashIV、信用卡專用 Action URL、是否為測試／正式環境），不必再到 Lovable Cloud 後台手動加 secrets。
2. 三個結帳頁（`Checkout.tsx`、`AppCheckout.tsx`、`CheckupCheckout.tsx`）的綠界選項中，**隱藏「ATM／超商」**，只保留「信用卡」。

## 設計原則：金鑰放哪？

綠界金鑰是高敏感資料，**前端絕對不能讀到**。做法：

- **存 DB**：放在 `payment_settings` 表，新增一個 `key='ecpay_credentials'` 的 row，`value` 為 JSON。
- **RLS**：沿用既有政策 — 只有 `company_admin` 可讀寫；前端一般使用者**不能 SELECT** 這筆。前端送出付款請求時，只呼叫 edge function，由 edge function 用 service role 讀取金鑰。
- **fallback**：edge function 先讀 DB；DB 沒設定時，回退讀 `Deno.env.get('ECPAY_*')`，向下相容。
- **只有「Action URL（信用卡專用）」會在後台顯示，金鑰本身為遮罩輸入** — 已存在時顯示為 `••••••••`，留空表示不變更，輸入新值才會覆寫。

```text
payment_settings
└─ key = 'ecpay_credentials'
   value = {
     merchant_id:        "3268740",
     hash_key:           "S8QlxefxBzJDYEBO",
     hash_iv:            "CJ0Lo2u7KJMBF9cF",
     credit_action_url:  "https://payment.ecpay.com.tw/.../V5",  // 信用卡專用
     api_url:            "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5", // 主 URL（保留供未來其他通道用）
     env:                "stage" | "production",
     updated_at:         "..."
   }
```

## 變更範圍

```text
DB（無 schema 變更，只塞一筆設定 row 由前端 upsert）
  └─ payment_settings  ('ecpay_credentials')  RLS = company_admin only

後台頁面
  └─ src/pages/company/Payments.tsx
       └─ 新增 Section「綠界金流設定」
          ├─ 商店代號（明文輸入）
          ├─ HashKey（遮罩，留空＝不變更）
          ├─ HashIV（遮罩，留空＝不變更）
          ├─ 信用卡專用 Action URL（明文）
          ├─ 環境：測試／正式（Select）
          ├─ 顯示「最後更新：YYYY/MM/DD」
          └─ 儲存按鈕 → upsert + logAdminAction

Edge Functions（讀 DB，DB 沒值才回退環境變數）
  ├─ supabase/functions/_shared/ecpayCredentials.ts   ← 新建 helper
  │     export async function loadEcpayCreds(supabase): Promise<{
  │       merchantId, hashKey, hashIV, creditActionUrl, apiUrl
  │     }>
  ├─ create-ecpay-order/index.ts          → 改用 helper
  ├─ create-checkup-ecpay-order/index.ts  → 改用 helper
  ├─ ecpay-callback/index.ts              → 用 helper 讀 hashKey/IV 驗 CheckMacValue
  └─ checkup-ecpay-callback/index.ts      → 同上

前端三個結帳頁
  ├─ src/pages/Checkout.tsx
  ├─ src/pages/app/AppCheckout.tsx
  └─ src/pages/CheckupCheckout.tsx
       └─ 隱藏「ATM／超商」選項（移除上次規劃的 RadioGroup，
          綠界選項直接固定送 paymentChannel='credit'，
          edge function 用信用卡 Action URL + ChoosePayment='Credit'）
       └─ AppCheckout.tsx 的 form.target 從 "_blank" 改 "_self"
```

## 實作步驟

1. **新建 shared helper** `supabase/functions/_shared/ecpayCredentials.ts`：用 service role 讀 `payment_settings` → 解析 → DB 缺欄位時回退 env，回傳統一物件。
2. **改 4 支 edge function** 全部改用 helper，`actionUrl` 從 `creditActionUrl` 取（信用卡通道唯一），CheckMacValue 用 helper 來的 hashKey/IV。
3. **後台 `Payments.tsx` 新增「綠界金流設定」Section**：
   - 載入時 `select value from payment_settings where key='ecpay_credentials'`。
   - 金鑰欄位採「遮罩 + 留空＝不變更」策略；存檔時若使用者沒輸入，沿用既有值。
   - 儲存後寫 `logAdminAction({ action: 'setting.ecpay_credentials_update', ... })`，不記錄金鑰實際值，只記 `merchant_id` 與 `env` 與「哪些欄位被更新」。
4. **三個前端結帳頁**：移除 ATM／超商選項，只留「信用卡」；送出時固定帶 `paymentChannel: 'credit'`。`AppCheckout` 的 form target 改 `_self`。
5. **驗證**：
   - 後台填入綠界資料 → 儲存 → 重新整理仍顯示 `merchant_id` 與遮罩金鑰、Action URL。
   - 走一次信用卡結帳，確認 edge function 用的是 DB 設定（log 印 merchant_id 比對）。
   - 把 `payment_settings` 那筆刪掉，確認 edge function 自動回退到環境變數，舊流程不退化。
   - 確認非 `company_admin` 使用者 `select * from payment_settings where key='ecpay_credentials'` 拿不到資料（RLS 已有 `company_admin only`，不需新增 policy）。

## 不會動到的部分

- `payment_providers` 表（綠界啟用／停用切換還是走原本那張表）。
- `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` / `ECPAY_MERCHANT_ID` 三個 secrets 保留作 fallback，不刪除。
- ACpay、LINE Pay、匯款流程。

## 安全性備註

- 金鑰仍是**只能 server-side 讀取**，前端不會持有原始值；後台輸入框送出後立即由 RLS-protected upsert 落 DB。
- audit log 不寫入金鑰原始值，只寫變更欄位清單與 `merchant_id`。
- 若你日後要再多一組「ATM／超商」用的 Action URL，只要在 `value` 加欄位即可，不需 schema 變更。

按這個計畫執行可以嗎？確認後我就切到執行模式，照上面 5 個步驟一次完成。
