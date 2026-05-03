## 目標
1. 持倉看板「覆蓋率」按鈕改名為「補齊報價」，按下去**直接觸發補抓**所有缺價持倉，完成後**只在仍有失敗時**彈窗，列出抓不到的代碼與原因（特別是非台股標的）。
2. 後台新增「缺價總覽」頁，集中查看所有用戶的補抓失敗紀錄，方便客服協助。

---

## A. 前端：按鈕與行為改寫
**檔案**：`src/pages/FreeCheckup.jsx`

1. 按鈕文案
   - 原：`覆蓋率 · 缺 N`
   - 新：缺 N>0 → `補齊報價 · {N}`；N=0 → `報價已齊`（仍可按以重檢）
   - title 改為「點擊後系統會幫你重抓所有缺價持倉，完成後若仍有失敗才會彈窗顯示」

2. 點擊行為（取代原本的 `setCoverageOpen(true)`）
   - DEMO 模式：直接 toast「DEMO 模式不執行補抓」
   - 收集 `missingCodes = H.filter 缺 priceSource 或有 priceError`
   - 若為空 → toast「報價已齊，無需補抓」並結束
   - `setBackfilling(true)`，按鈕顯示 `補抓中…`
   - 呼叫 `supabase.functions.invoke('stock-price-sync', { body: { symbols: missingCodes, force: true } })`
   - 等待完成後 `await refreshPrices()` 重算 H
   - 取回應 `{ fetched, missing, reasons }`：
     - `missing.length === 0` → toast「✓ 全部補齊（{N} 檔）」，**不開彈窗**
     - 仍有失敗 → 開彈窗顯示報告

3. 彈窗（沿用 `coverageOpen` state，改為「補抓報告」模式）
   - 頂部摘要：`補抓 N 檔 · 成功 X · 仍失敗 Y`
   - 表格只列「仍失敗」項目，欄位：代碼 / 名稱 / 你輸入的類型 / 原因
   - 原因前端歸類（依 `reasons[code]` + 規則判斷）：
     - `invalid_format` → 「非台股代號格式，系統僅支援台股上市櫃 / ETF / 權證」
     - `not_found` → 「TWSE/TPEx 都查無此代碼，可能已下市或代號錯誤」
     - `no_price` → 「查到代碼但無有效報價（停牌或當日無成交）」
     - 其他/未知 → 顯示原始 reason
   - 底部說明：「若您持有美股、港股、加密貨幣等海外標的，目前不支援自動報價，請於該檔持倉手動填入價格。」

---

## B. Edge Function：新增 symbols 模式
**檔案**：`supabase/functions/stock-price-sync/index.ts`

- 接受 POST body `{ symbols?: string[], force?: boolean }`
- 若 `symbols` 有值（symbols 模式）：
  - 自動 `force = true`（繞過交易時段守門，否則晚上沒反應）
  - 跳過原本的 `trade_signals` + `checkup_storage` 收集
  - 對每個 symbol 先檢驗格式 `/^\d{4,6}$/`，不合法 → 加進 `reasons[sym] = 'invalid_format'`
  - 合法的進 `fetchStockBatch`（已含 TPEx fallback）
  - 抓不到 → `reasons[sym] = 'not_found'`
  - 抓到但 price ≤ 0 / null → `reasons[sym] = 'no_price'`
  - 仍照常 upsert `current_prices`（成功的）
  - 不寫 `user_performances` / `user_summaries`（symbols 模式專責補價，不重算 PnL）
- 回傳：
  ```
  { success: true,
    requested: string[],
    fetched: number,
    missing: string[],
    reasons: { [symbol]: 'invalid_format' | 'not_found' | 'no_price' } }
  ```
- **同時**：每筆失敗寫進新表 `checkup_price_misses`（見 C），供後台總覽

---

## C. 資料庫：缺價紀錄表
新增 migration：

```sql
create table public.checkup_price_misses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                 -- 觸發者（symbols 模式由 caller JWT 取，沒有就 null）
  symbol text not null,
  reason text not null,         -- invalid_format / not_found / no_price / other
  attempts int not null default 1,
  last_error text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, symbol)
);

alter table public.checkup_price_misses enable row level security;

-- 用戶只能看自己的
create policy "own misses" on public.checkup_price_misses
  for select to authenticated using (user_id = auth.uid());

-- 後台 (company_admin) 看全部
create policy "admin view all misses" on public.checkup_price_misses
  for select to authenticated
  using (public.has_role(auth.uid(), 'company_admin'));
```

Edge function 寫入邏輯：
- 失敗 → upsert：`attempts = attempts + 1, last_seen_at = now(), reason = ?, last_error = ?`
- 該 symbol 後續補抓成功 → `update set resolved_at = now()`

---

## D. 後台頁：缺價總覽
**新檔**：`src/pages/company/MissingPrices.tsx`
**路由**：`/company/missing-prices`，加進 `CompanyLayout` 側欄（角色 `company_admin` 可見）

頁面內容：
- 上方篩選：狀態（未解決 / 已解決 / 全部）、原因、用戶 email 模糊搜尋
- 表格：用戶 email / 代碼 / 原因 / 嘗試次數 / 首次發生 / 最近發生 / 解決時間 / 操作
- 操作欄：「重試補抓」按鈕（呼叫同一個 edge function 帶該 symbol）
- 右上「匯出 CSV」

---

## 白話總結
- 「覆蓋率」改名「補齊報價」，按一下就直接幫你補抓，全成功就不彈窗打擾。
- 抓不到的（例如美股代號）才會彈窗逐筆告訴你原因。
- 後台多一頁「缺價總覽」，客服可以看到所有用戶哪些代碼一直抓不到，主動協助處理。
