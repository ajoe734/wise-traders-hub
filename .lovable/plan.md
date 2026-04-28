# 付費服務整合：健檢獨立商品 + 跨產品折扣 + 渠道追蹤 + 可調分潤

## 一、商品矩陣（最終）

| 商品 | 月費 | 年費 | 額度 |
|------|------|------|------|
| 跟單派 L2（既有） | 1,699 | 16,990 | — |
| 修煉派（既有） | 799 | 7,990 | — |
| **持股健檢 · 基礎（新）** | **699** | **6,990** | 每月 4 次 |
| **持股健檢 · 進階（新）** | **1,299** | **12,990** | 每月 22 次（軟上限，不擋） |

## 二、跨產品折扣（最終）

| 已持有 | 後購買 | 折扣（每期都享有） |
|--------|--------|-----|
| 任一專家訂閱 | 健檢基礎 | -100 |
| 任一專家訂閱 | 健檢進階 | -200 |
| 健檢基礎 | 任一專家 | -100 |
| 健檢進階 | 任一專家 | -200 |

- 月升年：剩餘月費按比例折抵年費差額；折扣狀態跟著新訂閱繼續適用。
- 折扣承擔：折扣金額**從被折方那一邊扣**（健檢視為平台自營，折扣由平台分潤池吸收）。

## 三、分潤規則（**改為可個別設定**）

### 預設值（系統初始）
| 情境 | 平台 | 專家 | 渠道保留 |
|------|------|------|---------|
| 無交叉折扣 | 55% | 45% | 0% |
| 被導流（utm 命中且非自家流量） | 35% | 45% | 20% |
| 健檢商品（自營） | 100% | — | — |

### 可調維度
1. **專家個別覆寫**：在 admin「專家管理」頁，每位專家可設自己的 `(平台 / 專家 / 渠道)` 三組百分比，留空則套預設。
2. **渠道個別覆寫**：在 admin「渠道管理」新頁，每個 utm_source 可設自己的 `(平台 / 專家 / 渠道)` 三組百分比，留空則套預設。
3. **生效優先序**：`渠道覆寫 > 專家覆寫 > 系統預設`（命中即停，不混算）。
4. **快照保存**：每筆 transaction 建立時把當下生效的拆分 % + 來源（系統/專家/渠道）寫進 `revenue_splits.rule_snapshot`，**事後改設定不回溯舊單**。
5. **驗證**：三項加總必須 = 100，否則拒存。

> 「渠道紀錄 20%」推薦人功能未開時，金額暫記 `channel_reserve` 欄位，不發放。

## 四、渠道追蹤（先到先得）

- 進站若帶 `?ref=xxx` 或 `utm_*` → 寫 cookie + localStorage `lf_attr`，**TTL 30 天**。
- 期間內新 utm **不覆蓋**；30 天後才允許新來源寫入。
- 結帳時把 `lf_attr` snapshot 存進 `payment_transactions.attribution`。
- 「自家流量」判定：`utm_source` 不在 `referral_channels` 表（或 source 為空）視為自然流量，套無導流規則。

## 五、付款方式

- **綠界（既有）**：信用卡、ATM、超商代碼
- **新增：銀行匯款**
  - Checkout 顯示收款帳號（後台 `payment_settings` 設定，先留空）
  - 使用者填**帳號末五碼 + 姓名** → 建立 `remittance_orders` (status=pending)
  - 後台「待對帳」頁，admin 點「開通」→ 觸發 `paymentProcessor.createSubscriptionAndTransaction`，同步寫 `revenue_splits`，發通知

## 六、資料庫變更

### 新表
```sql
-- 渠道歸因（30 天鎖）
referral_attributions (
  id uuid pk, user_id uuid, utm_source/medium/campaign text,
  ref_code text, locked_until timestamptz, created_at timestamptz
)

-- 渠道主檔（admin 可建可調分潤）
referral_channels (
  id uuid pk, source text unique,           -- e.g. 'youtuber_a'
  display_name text, is_active boolean default true,
  pct_platform int, pct_expert int, pct_channel int,  -- 加總 100，可為 null（套預設）
  created_at timestamptz
)

-- 匯款待對帳
remittance_orders (
  id uuid pk, user_id uuid, plan_id uuid, billing_cycle text,
  amount int, last5 text, payer_name text,
  status text default 'pending',            -- pending/confirmed/rejected
  confirmed_by uuid, confirmed_at timestamptz, created_at timestamptz
)

-- 分潤明細（每筆交易拆分快照）
revenue_splits (
  id uuid pk, transaction_id uuid, expert_id uuid,
  gross int, discount int, discount_source text,
  platform_amount int, expert_amount int, channel_reserve int,
  rule_snapshot jsonb,                       -- {source:'channel'|'expert'|'default', pct:{...}}
  utm_snapshot jsonb, created_at timestamptz
)

-- 平台預設分潤 + 收款帳號（key/value）
payment_settings (
  id uuid pk, key text unique, value jsonb, updated_at timestamptz
)
-- seed:
--   key='split_default_no_referral'      value='{"platform":55,"expert":45,"channel":0}'
--   key='split_default_with_referral'    value='{"platform":35,"expert":45,"channel":20}'
--   key='remittance_account'             value='{"bank":"","name":"","account":""}'
```

### 既有表擴充
```sql
-- experts 加分潤覆寫
ALTER TABLE experts
  ADD COLUMN split_no_ref jsonb,    -- {platform,expert,channel} 或 null
  ADD COLUMN split_with_ref jsonb;

-- payment_transactions 加 attribution + 折扣紀錄
ALTER TABLE payment_transactions
  ADD COLUMN attribution jsonb,
  ADD COLUMN original_amount int,
  ADD COLUMN discount_amount int default 0,
  ADD COLUMN discount_reason text;

-- 新增健檢 plan_type
ALTER TYPE plan_type ADD VALUE 'checkup_basic';
ALTER TYPE plan_type ADD VALUE 'checkup_pro';
```

### 共用拆分函式（_shared）
`computeRevenueSplit({ amount, expertId, attribution })`：
1. 若 `attribution.utm_source` 命中 `referral_channels` 且該列三 % 都非 null → 用渠道覆寫
2. 否則若 `experts.split_*` 非 null → 用專家覆寫
3. 否則套 `payment_settings` 預設
4. 健檢商品強制 platform=100
5. 回傳含 `rule_snapshot`

## 七、Edge Functions

| 動作 | 檔案 |
|------|------|
| 改：計算折扣 + 寫 attribution | `create-ecpay-order` |
| 改：付款成功寫 `revenue_splits`（呼叫 computeRevenueSplit） | `ecpay-callback` |
| 新：建立匯款訂單 | `create-remittance-order` |
| 新：admin 開通匯款 | `confirm-remittance` |
| 新：月→年按比例升級 | `upgrade-subscription` |
| 新：續扣前重算雙邊折扣 | `recompute-recurring-discount`（cron） |

## 八、前端變更

| 頁面 | 變更 |
|------|------|
| `Pricing.tsx` | 新增「持股健檢」獨立商品區（基礎/進階、月/年） |
| `Checkout.tsx` | 顯示折扣明細、加「銀行匯款」付款選項 + 末五碼欄位 |
| `app/Account.tsx` | 月訂閱顯示「升級年費」CTA + 試算 |
| `FreeCheckup.jsx` | CTA 導向健檢方案購買頁 |
| 新 `lib/referralTracker.ts` | 進站寫 `lf_attr` + 30 天鎖 |
| `company/Revenue.tsx` | 加「分潤明細」+「渠道轉換」分頁 + CSV 匯出 |
| 改 `company/Analysts.tsx` | 每位專家加「分潤覆寫」設定區（兩組三欄 %） |
| **新 `company/Channels.tsx`** | 渠道清單 CRUD，每筆可設分潤覆寫 |
| 新 `company/Remittance.tsx` | 待對帳列表 + 開通按鈕 |
| 新 `company/PaymentSettings.tsx` | 設預設分潤 + 匯款收款帳號 |

## 九、實作順序（4 階段）

1. **DB schema + enum + seed 預設值** → migration
2. **健檢商品上架 + Pricing/Checkout 顯示**（可賣）
3. **匯款流程 + 後台對帳頁 + 收款帳號設定**
4. **渠道追蹤 + 分潤覆寫（專家+渠道）+ 升級流程 + 折扣重算 cron + Revenue/Channels 後台**

每階段獨立可上線，互不擋路。
