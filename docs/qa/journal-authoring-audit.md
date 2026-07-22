# 週記撰寫零錯誤深掃 — 稽核 & 修法交付紀錄

> 對齊計劃：`.lovable/plan.md`「10 步細化計劃」  
> 憲法：`mem://features/mentor-publishing-workflow`、`mem://logic/trading/*`、  
> `mem://logic/trading/ui-to-system-action-mapping`

---

## 1. 稽核腳本

`scripts/audit-journal-authoring.mjs` — read-only 全量掃描 6 大類：

| # | Bucket key | 檢查對象 | 對應 DB 憲法 |
|---|---|---|---|
| 1 | `unit_mismatch` | `trade_records.status='open'` + `expert_signals.status='pending'` 的 `quantity_unit` × `experts.asset_class` | `enforce_unit_consistency` |
| 2 | `signal_quality` | `expert_signals` 缺 action / quantity=0 / price_hint=0 / teaching 缺 learning_points 或 teaching_topic | `publish-weekly-journals` error codes |
| 3 | `capital_missing` | `experts.starting_capital` 缺漏或 ≤ 0 | `enforce_signal_capital_limit` |
| 4 | `slug_desync` | `profiles.expert_slug` ↔ `experts.slug` 不同步 | analyst credential trigger |
| 5 | `currency_mismatch` | `trade_records.currency` × `experts.asset_class`（us_stock+TWD 等） | `sanitizeAssetQuantityUnit` |
| 6 | `tw_lot_integrity` | 台股 open 且 `quantity_unit='張'` 但 quantity 非整數 | 台股張→base ×1000 單一入口 |

用法：

```bash
node scripts/audit-journal-authoring.mjs         # 人眼摘要
node scripts/audit-journal-authoring.mjs --json  # 供 CI 比對
```

Exit code：`0` 全部歸零，`2` 有髒資料。

**目前基線（P0 完成後）：全 6 類皆為 0 筆。**

---

## 2. Step 1–7 缺陷清單 × Step 8 修法對照

| 步驟 | 發現 | 修法檔案 |
|---|---|---|
| 1 表單入口 | `emptyTrade` 對美股仍 default `'張'` | `src/pages/_signalEditor/types.ts`、`SignalCreateDialog.tsx` 改由 `sanitizeAssetQuantityUnit(assetClass)` 決定 |
| 2 持倉帶入 | open→buy/add/sell 未沿用來源 unit | `useExpertHoldingsBundle.ts`、`positionQuantity.ts`；統一走 `sanitizeAssetQuantityUnit` |
| 3 觸發器 | `handle_signal_trade` 部分分支未做 base 換算 | migration：所有 `RAISE EXCEPTION` 補中文 HINT + row_id + 允許值；台股「張」×1000 集中於 trigger |
| 4 稽核腳本 | 舊資料殘留單位/幣別衝突 | 一次性 backfill migration + `scripts/audit-journal-authoring.mjs` 建立 |
| 5 發布路徑 | 一筆錯誤炸掉整批 | `supabase/functions/publish-weekly-journals/index.ts`：per-signal try/catch、6 種 error code 中文化、通知 + 修正連結 |
| 6 匯出/推播 | 匯出仍有 `'張'` 字面 fallback | `src/lib/journalsExport.ts`、`exportJournalPdf*`、`line-push-signal` 全走 `resolvePdfQuantityUnit / resolveLinePushQuantityUnit` |
| 7 顯示層 | teaching 未渲染 `learning_points`、currency fallback 缺 | `SignalDetail.tsx`、`JournalDetail.tsx`、`TradeCard.tsx`、`CapitalPanel.tsx` 全部改用 `sanitizeAssetQuantityUnit` + currency fallback chain |

---

## 3. Step 9 測試清單（P0 已通過）

**Vitest（1783 passed）**

- `src/test/displayLayerUnit.test.ts`
- `src/test/exportJournalPdfQuantityUnit.test.ts`
- `src/test/integration/1.37-us-asset-unit-single-source.test.ts`
- `src/test/signal-editor-currency.test.tsx`
- `positionQuantity` / `sanitizeAssetQuantityUnit` unit matrix

**Playwright（journals-export 全套 171/171）**

- `e2e/journals-export-markdown-download.spec.ts`
- `e2e/journals-export-quantity-unit-default.spec.ts`
- `e2e/journals-export-weekly-totals.spec.ts`
- `e2e/journals-export-dual-unit-totals.spec.ts`
- `e2e/journals-export-week-separator-tolerance.spec.ts`
- `e2e/journals-export-weekly-totals-whitespace-tolerance.spec.ts`
- `e2e/journals-export-yankai-4576-no-sell.spec.ts`
- `e2e/journals-export-missing-fields-fallback-visual.spec.ts`
- `e2e/journals-export-zip-order-and-concurrency.spec.ts`
- `e2e/signal-detail-preview-currency-schema.spec.ts`

**Edge function Deno tests**

- `supabase/functions/publish-weekly-journals/*.test.ts`：`UNIT_CONFLICT / CAPITAL_EXCEEDED / OVERSELL / QUANTITY_ZERO / MISSING_FIELDS / TRIGGER_RAISED` 各 ≥ 1 case

---

## 4. CI 掛載

`.github/workflows/journal-authoring-audit.yml`

- 排程：UTC 20:00（台北 04:00）nightly + `workflow_dispatch`
- 執行 `node scripts/audit-journal-authoring.mjs --json`
- 非零即 fail、上傳 `audit.json` artifact 保留 30 天

---

## 5. 憲法更新

- `mem://features/mentor-publishing-workflow`：加入「單位單一來源 + 發布 error code 中文化」正式列為憲法
- Core memory：所有寫入 quantity_unit 的入口一律經 `sanitizeAssetQuantityUnit(assetClass)`；顯示層一律經 `formatBaseQuantity`；台股「張→股 ×1000」只在 `handle_signal_trade` 做一次
