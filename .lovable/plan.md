## 目標

TWSE openapi `t187ap37_L` 對 Supabase edge function 出口 IP 縮流（回應被截斷 → parser 抓 0 筆）。把「抓 + 寫入 warrant_expiry」這段搬到 GitHub Actions runner 執行，Actions IP 不在被擋名單，能穩定拿到完整 25MB JSON。`reconcile-warrant-quantities` 邏輯完全不動——它只讀 `warrant_expiry` 對帳，資料是誰寫的它不在乎。

## 架構

```text
┌────────────────────────┐  cron 15 14 * * 1-5 (Asia/Taipei 22:15)
│ GitHub Actions runner  │──► TWSE openapi (完整 JSON)
│  refresh-warrant-basic │──► Supabase REST /warrant_expiry (service role upsert)
└────────────────────────┘
              │
              ▼ chain trigger (workflow 最後一步)
┌────────────────────────┐
│ reconcile-warrant-     │──► trade_records 對齊 signal × exercise_ratio
│   quantities (edge)    │──► audit_logs / system_alerts
└────────────────────────┘
```

## 步驟

### 1. 新增 `scripts/refresh-warrant-basic.mjs`
- 同 `refresh-stock-industry.mjs` 的 CLI 模式，Node 20 + `undici` 原生 fetch。
- 抓 `https://openapi.twse.com.tw/v1/opendata/t187ap37_L`（上市）+ TPEx 對應端點（若存在，先確認；沒有就先只做上市，覆蓋 062787 等主流權證）。
- Parser 沿用現行 edge 版本裡的 `RegExp` per-record 抽取（已證明能撐住截斷 JSON，但在 Actions runner 上應該拿到完整檔）。
- Upsert 進 `public.warrant_expiry`：`symbol / name / parent_code / expire_date / exercise_ratio / strike_price / call_put / fetched_at`。走 Supabase REST `POST /rest/v1/warrant_expiry?on_conflict=symbol` + `Prefer: resolution=merge-duplicates`，用 `SUPABASE_SERVICE_ROLE_KEY`。
- Dry-run 模式（`--dry`）只印 summary、不寫 DB，供 PR 檢查。
- 輸出 JSON summary（fetched / parsed / upserted / with_ratio / missing_ratio）到 stdout，Actions job summary 貼上去。

### 2. 新增 workflow `.github/workflows/refresh-warrant-basic.yml`
- Trigger：
  - `schedule: cron: '15 14 * * 1-5'`（UTC = Asia/Taipei 22:15，收盤 + 資料落地後）
  - `workflow_dispatch`（手動觸發，含 `dry_run` input）
- Job：Node 20 → `node scripts/refresh-warrant-basic.mjs` → 成功後 `curl -X POST` 打 `reconcile-warrant-quantities` edge function 收尾。
- Secrets（repo settings 需新增／確認）：
  - `SUPABASE_URL`（或用已存在的 `VITE_SUPABASE_URL` 對映）
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ANON_KEY`（呼叫 reconcile 用）
- 失敗處置：任何 step 非 0 → workflow fail + `system_alerts` 寫一筆（reconcile edge 本來就會做，或在 script 內直接寫 `system_alerts` 的 upsert）。

### 3. 停用 edge 版排程，保留手動入口
- `supabase/config.toml` 移除 `checkup-warrant-sync` 的 cron（若有）。
- edge function `checkup-warrant-sync/index.ts` 保留，改成純 fallback：只有當 reconcile 發現某檔 `exercise_ratio IS NULL` 才會被 chain 呼叫做單檔補抓（現行邏輯已支援）。
- README 或 function 檔頭註記：主排程已改走 GitHub Actions，這裡只留 on-demand fallback。

### 4. 驗收
1. 手動 `workflow_dispatch` 跑一次 → job summary 顯示 `parsed: > 700`（TWSE 目前約 8000+ 支上市權證，全欄含 ratio 應 > 90%）。
2. `SELECT COUNT(*) FROM warrant_expiry WHERE exercise_ratio IS NOT NULL` 從目前 0（或很少）→ 應 > 5000。
3. 062787 那筆：`SELECT symbol, exercise_ratio FROM warrant_expiry WHERE symbol='062787'` 應回傳實際比例（0.0004 = 每張換 0.0004 股標的，或 2500 視 TWSE 欄位定義而定；以資料為準）。
4. workflow chain 呼叫 reconcile → `trade_records` 中 062787 的 quantity 自動對齊 signal × ratio，`audit_logs` 出現一筆 `warrant_ratio_reconcile`。
5. `system_alerts` 中 `warrant_missing_ratio` 類的告警應清零或只剩極少數 TWSE 本身沒提供的異常檔。

## 技術細節

**新增檔案：**
- `scripts/refresh-warrant-basic.mjs`
- `.github/workflows/refresh-warrant-basic.yml`

**修改檔案：**
- `supabase/functions/checkup-warrant-sync/index.ts`（檔頭註記 + 明確標示為 on-demand fallback；核心邏輯不變）
- `supabase/config.toml`（如有 cron 條目則移除）

**不動的檔案：**
- `supabase/functions/reconcile-warrant-quantities/index.ts`
- `public.warrant_expiry` schema
- 前端所有持倉相關程式碼

**Secrets 需求（若尚未設定，需請你在 GitHub repo Settings → Secrets and variables → Actions 新增）：**
- `SUPABASE_URL`（值：專案 REST URL，非公開文件不列於此）
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`

## 影響範圍

- 只影響權證主檔資料流；台股 / 美股 / 加密 / 衍生商品完全不動。
- edge 版沒刪，只是降級為 fallback，回滾成本 = 在 workflow 停用 schedule 即可。
- 資料寫入路徑改成 service role over REST，與現行 edge 用 service role 語意相同，RLS / GRANT 無需調整。

執行前請確認：GitHub repo 是否已有 `SUPABASE_SERVICE_ROLE_KEY` 等 secrets？若沒有我會在 build 階段列出所需，麻煩你到 repo settings 加。
