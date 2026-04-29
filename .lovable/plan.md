
# 金流設定重構計畫（最終版）

## 你的三個決定

1. **導流分潤功能整個關掉**：拿掉 `*` 檔位、不再支援「來源覆寫」、`referral_channels` 整頁與 `attribution → 分潤` 邏輯全部停用。
2. **舊 `experts.split_no_ref / split_with_ref` 欄位**：移轉資料後直接 DROP。
3. **健檢分潤**：維持平台 100%，不開放 UI 覆寫。

---

## 重構後架構（精簡版）

```text
分潤決定樹（calcSplit）
├─ productKind = 'checkup'  → checkup_default (100% 平台)
└─ productKind = 'expert_plan'
     ├─ 1. 方案覆寫 plan_split_overrides[plan_id]   ← 新功能
     └─ 2. 全站預設 split_standard
```

**沒有了**：被導流分潤、通路 reserve、attribution-based override、`split_attributed`、`channel_override`。  
**保留**：`referral_attributions` 表本身（給未來行銷分析用），但**不再影響金流**。

---

## 1. 資料庫變更（單一 migration）

### 新表 `plan_split_overrides`
```sql
create table public.plan_split_overrides (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.expert_plans(id) on delete cascade,
  pct_platform int not null check (pct_platform between 0 and 100),
  pct_expert int not null check (pct_expert between 0 and 100),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id),
  check (pct_platform + pct_expert = 100)
);
alter table public.plan_split_overrides enable row level security;
create policy "Admins full access" on public.plan_split_overrides
  for all to authenticated
  using (has_role(auth.uid(),'company_admin'))
  with check (has_role(auth.uid(),'company_admin'));
create policy "Experts view own plan splits" on public.plan_split_overrides
  for select to authenticated
  using (plan_id in (
    select ep.id from expert_plans ep
    join experts e on e.id = ep.expert_id
    where e.user_id = auth.uid()
  ));
```
（每個方案最多一筆覆寫；只有 platform/expert 兩欄因為通路被砍了。）

### 資料移轉（一次性 SQL，在同一個 migration 裡）
```sql
-- 把 experts.split_no_ref 寫成各自 plan 的覆寫
insert into plan_split_overrides (plan_id, pct_platform, pct_expert)
select ep.id,
       coalesce((e.split_no_ref->>'platform')::int, 55),
       coalesce((e.split_no_ref->>'expert')::int, 45)
from expert_plans ep
join experts e on e.id = ep.expert_id
where e.split_no_ref is not null
on conflict (plan_id) do nothing;
```

### Drop 舊欄位
```sql
alter table experts drop column split_no_ref;
alter table experts drop column split_with_ref;
```

### 清理 `payment_settings`
```sql
delete from payment_settings where key in (
  'split_default_no_referral',
  'split_default_with_referral',
  'split_default_checkup',
  'cross_discount_rules',
  'split_attributed'        -- 不再使用
);
```

### `revenue_splits.rule_source` CHECK 收斂
```sql
alter table revenue_splits drop constraint if exists revenue_splits_rule_source_check;
alter table revenue_splits add constraint revenue_splits_rule_source_check
  check (rule_source in ('plan_override','standard_default','checkup_default'));
```
（只剩三種，因為 attribute / channel 都砍了。）

### `referral_channels` 表處理
留表不刪（避免破壞既有 RLS 與審計），但 UI 入口移除、不再寫入也不再讀取。後續可在獨立清理 migration 裡 drop。

---

## 2. 後端邏輯

### `supabase/functions/_shared/revenueSplit.ts`
大幅瘦身：
```ts
export interface SplitInput {
  productKind: 'expert_plan' | 'checkup';
  gross: number;
  discount: number;
  discountSource?: string | null;
  planOverride?: SplitRule | null;     // 來自 plan_split_overrides
  defaults: { standard: SplitRule; checkup: SplitRule };
}

export function calcSplit(input): SplitOutput {
  const net = Math.max(0, input.gross - input.discount);
  if (input.productKind === 'checkup') {
    return { net, platform_amount: net, expert_amount: 0, channel_reserve: 0,
             rule_source: 'checkup_default', rule_snapshot: input.defaults.checkup };
  }
  const rule = input.planOverride ?? input.defaults.standard;
  const source = input.planOverride ? 'plan_override' : 'standard_default';
  const platform = Math.round(net * rule.pct_platform / 100);
  const expert = net - platform;  // 殘差給 expert
  return { net, platform_amount: platform, expert_amount: expert,
           channel_reserve: 0, rule_source: source, rule_snapshot: rule };
}
```
- 移除 `isAttributed`、`channelOverride`、`expertOverride`、`split_attributed` 邏輯。
- `loadPaymentDefaults` 回傳簡化為 `{ standard, checkup, crossDiscounts }`。

### `supabase/functions/_shared/paymentProcessor.ts`
`buildSplitInput` 改為查 `plan_split_overrides`：
```ts
const { data } = await supabase
  .from('plan_split_overrides')
  .select('pct_platform, pct_expert')
  .eq('plan_id', planId)
  .eq('is_active', true)
  .maybeSingle();
const planOverride = data ? { ...data, pct_channel: 0 } : null;
```
拿掉 `experts.split_no_ref` 與 `referral_channels` 兩段查詢。

### `attribution` 仍寫入（行銷追蹤用）
- `payment_intents.attribution`、`payment_transactions.attribution`、`revenue_splits.utm_snapshot` 繼續記錄，**只是不再驅動分潤**。
- `useAttributionTracking` hook 保留。
- `useCrossProductDiscount` 不受影響（折扣邏輯與分潤無關）。

### 受影響但只需重新部署的 edge functions
`confirm-remittance`、`ecpay-callback`、`checkup-ecpay-callback`、`create-acpay-order`、`create-linepay-order`、`acpay-notify`、`confirm-linepay`。

---

## 3. UI 重構

### `/company/payment-settings`（精簡）
保留四個區塊：
1. **標準分潤預設**（pct_platform / pct_expert，總和=100；只剩兩欄）
2. **健檢分潤**（唯讀展示「平台 100%」）
3. **跨產品折扣**（NT$ 設定，現有四個 key）
4. **匯款帳戶**（bank_name / bank_code / account_number / account_name）

刪除：
- 「被導流分潤」整段
- 任何提及「通路」「utm」的欄位

### 新頁 `/company/plan-splits`（核心新功能）
依分析師分群顯示所有方案，每方案最多一條覆寫：

```text
分析師：王大明
  ├ 跟單派           [預設 55/45]    [新增覆寫]
  └ 跟單派 進階方案  [覆寫 60/40] ✎ [編輯][停用][刪]

分析師：李小華
  └ 修煉派           [預設 55/45]    [新增覆寫]
```

編輯彈窗欄位：
- 平台 %（0–100）
- 專家 %（自動 = 100 − 平台）
- 啟用 switch
- 備註

### 路由 / Sidebar
- `App.tsx` 加 `/company/plan-splits`
- `CompanyLayout` sidebar 加入口「方案分潤」
- **移除** `/company/referral-channels` 連結（路由保留以免外連 404，頁面換成「此功能已停用」）

---

## 4. 測試

### 改寫
- `src/test/unit/1.30-revenue-split.test.ts`：
  - 移除 attributed / channelOverride / expertOverride 所有 case
  - 新增：`planOverride` 勝過 `standard_default`
  - 新增：`planOverride=null` → `standard_default`
  - 健檢無視 `planOverride`
- `src/test/integration/1.34-confirm-remittance-flow.test.ts`：
  - mock 從 `experts.split_no_ref` 改為 `plan_split_overrides`
  - 移除 `channel_override` case

### 新增
- `src/test/unit/1.35-plan-override-resolution.test.ts`：
  - `is_active=false` 的覆寫應被忽略
  - 多筆同 plan_id（理論不可能，唯一鍵）防呆
  - `pct_platform + pct_expert ≠ 100` 時應在 UI 層被擋（單元測 validator）

### `1.31-cross-discount` / `1.32-upgrade-proration` / `1.33-attribution-lock`
不受影響，保持原樣（attribution 還在，只是不影響分潤）。

---

## 5. 上線步驟

1. Migration（建表 + 移轉 + drop 舊欄位 + 清理 settings + 收斂 CHECK）
2. 改 `revenueSplit.ts`、`paymentProcessor.ts` 並重新部署所有金流 edge functions
3. 改 `PaymentSettings.tsx`、新增 `PlanSplits.tsx`、調整 `App.tsx` 與 `CompanyLayout`
4. 改測試 + 新增測試
5. 更新 memory：`mem://features/billing/payment-settings-keys` 鎖定新 schema 與「導流分潤已停用」事實

---

## 風險提醒

- **DROP 欄位不可逆**：`experts.split_no_ref / split_with_ref` 移轉後立即 drop。如果你之後想重新啟用導流分潤，需要重新加欄位或直接擴充 `plan_split_overrides`（schema 已預留只差加 `source` 欄位）。
- **既有 `revenue_splits` 歷史紀錄** 仍含 `channel_override / attributed_default / expert_override` 等 `rule_source`，新 CHECK 會擋住「未來新寫入」這些值，但既有資料 CHECK 不會回查，安全。
- **referral_channels 表中既有資料** 不刪，僅 UI 隱藏。

如果以上沒問題就按 Approve，我直接執行。
