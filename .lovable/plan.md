
# Stage 1–4 重新檢查結果與修補計畫

## 重大缺陷（現在會直接壞掉的）

### 1. `payment_settings` key 命名分裂（Stage 1 vs Stage 3）
Stage 1 migration seed 用的是：
- `split_default_no_referral` / `split_default_with_referral` / `split_default_checkup`
- `cross_discount_rules`（鍵名 `expert_then_basic` 等）
- `remittance_account` 欄位是 `bank/branch/name/account`

但 Stage 3 程式（`revenueSplit.ts` / `useCrossProductDiscount.ts` / `PaymentSettings.tsx` / `CheckupCheckout.tsx` 讀取面）期待：
- `split_standard` / `split_attributed` / `split_checkup`
- `cross_discounts`（鍵名 `has_checkup_basic_discount_on_expert` 等）
- `remittance_account` 欄位是 `bank_name / bank_code / account_number / account_name`（後台寫的） ↔ `bank/name/account`（前台讀的）

→ 結果：分潤永遠走預設值、跨產品折扣永遠 0、後台填的匯款帳戶在 Checkout 顯示空白。

### 2. `revenue_splits.rule_source` CHECK 與程式值不符
DB CHECK：`('channel','expert','default','checkup')`  
程式寫入：`'expert_override' | 'channel_override' | 'attributed_default' | 'standard_default' | 'checkup_default'`  
→ 每筆 `writeRevenueSplit` 都會被 CHECK 擋下，分潤紀錄整批寫不進去。

### 3. `confirm-remittance` 不寫交易紀錄、也不寫分潤
匯款付款只更新 `remittance_orders.status` 與啟用訂閱，但完全沒插 `payment_transactions`，也沒呼叫 `writeRevenueSplit`。  
→ MRR/營收/分潤統計把所有匯款都漏算。

### 4. `confirm-remittance` 沒處理「升級扣抵」
若使用者已有 active 訂閱（月→年升級），會直接再 insert 一筆 active，導致同人同方案兩筆並存。

### 5. `payment_transactions` 沒有 INSERT RLS policy
`paymentProcessor` 透過 service role 寫入沒問題，但表上沒給任何角色 INSERT 權限的設計顯示本來就只允許後端寫；這是 OK 的，列為「已驗證安全」。

### 6. `referral_channels` 的 CHECK 與覆寫匹配邏輯有破口
DB CHECK 要求三欄 NULL 或加總 100。`writeRevenueSplit` 用 `pct_platform != null` 判斷是否 override；但若 admin 設了 0/0/100 之類有效規則，邏輯仍會啟用，OK。但 `referral_channels.source` 若使用大小寫差異，比對端用 `.toLowerCase()`，DB 不強制 lower → 建議 trigger 強制 lower。

### 7. 首次 attribution 鎖期 & user_id backfill：DB 端沒鎖
`useAttributionTracking` 在前端不覆寫，但若惡意呼叫 RPC 仍可寫多筆。低優先，本期先以前端鎖為主。

---

## 計畫修補

### A. 統一 payment_settings 結構（migration）
新增 migration：
- 將 Stage 1 seed 的舊鍵 `split_default_no_referral/with_referral/checkup` 重新命名（或用 INSERT…ON CONFLICT 寫入新鍵 `split_standard/attributed/checkup`）。
- `cross_discount_rules` 內容轉成 `cross_discounts`，欄位重對應。
- `remittance_account` seed 改成 `{bank_name,bank_code,account_number,account_name}`。
- 修正 `revenue_splits` CHECK：擴充至 `('channel_override','expert_override','attributed_default','standard_default','checkup_default')`。

CheckupCheckout 讀取面同步改成新欄位（bank_name 等）。

### B. 修 `confirm-remittance`
- 啟用前 query 既有 active 訂閱：若有 → 走「延長 expires_at」/proration 而非新建。
- 啟用後寫入 `payment_transactions`（status=paid, provider_id=remittance）。
- 呼叫 `writeRevenueSplit`，帶上 order 內的 `attribution / original_amount / discount_*`。
- product kind 對應 `productKind: 'checkup'` / `'expert_plan'`。

### C. 確保所有金流路徑都會寫 intent + split
- 已驗證 ecpay 兩條（expert_plan / checkup）OK。
- 未驗證但已寫過：acpay-notify、confirm-linepay → 加 grep 確認，缺則補 intent 寫入。

### D. 補上自動化測試（Vitest）
新增單元測試（純函式優先，不用 DB）：

1. `src/test/unit/1.30-revenue-split.test.ts`
   - 健檢：100% 平台、不論 attribution。
   - 標準：utm 為空 / 'organic' / 'direct' / 'legendflow' → 走 standard。
   - 被導流：utm_source='facebook_ads' → 走 attributed。
   - channelOverride 存在且被導流 → 走 channel override。
   - expertOverride 存在 → expert override 蓋過 attributed/standard。
   - 折扣後 net = gross - discount，三項加總 = net（殘差給 expert）。

2. `src/test/unit/1.31-cross-discount.test.ts`
   - 買 expert_plan + 已持 checkup pro → 200。
   - 買 expert_plan + 已持 checkup basic → 100。
   - 買 checkup pro + 已持 expert → 200。
   - 買 checkup basic + 已持 expert → 100。
   - 兩邊都沒有 → 0。

3. `src/test/unit/1.32-upgrade-proration.test.ts`
   - 月→年 剛開通（remain≈full）：credit ≈ monthlyPrice。
   - 月→年 期中：credit ≈ monthlyPrice/2。
   - 已過期：credit = 0。
   - chargeAmount = max(0, yearly - credit)。

4. `src/test/unit/1.33-attribution-lock.test.ts`
   - `readAttribution` 過期清除。
   - 首觸寫入後 `locked_until` ≈ now+30d。
   - 已存在 + 第二次帶新 utm：仍回原 payload（不覆寫）。

5. `src/test/integration/1.34-confirm-remittance.test.ts`（mock supabase）
   - confirmed → 寫入 payment_transactions、writeRevenueSplit 被呼叫。
   - 已有 active 訂閱 → 不重建第二筆。

### E. memory 更新
新增 `mem://features/billing/payment-settings-keys` 鎖定 key 命名與 schema，避免日後再分裂。

---

## 不在這次處理範圍

- referral_channels.source 大小寫 trigger（風險低，下一輪）
- 真正打 DB 的端到端測試（需 service role，留到 e2e 階段）
- 升級 proration 應退舊訂閱：本期僅在 ECPay 流（已記 `upgrade_from_subscription_id`）；匯款流的升級補價會在 confirm-remittance 處理「延長」即可
