## 為什麼後台看不出有這麼多使用量

我重新查了一次，差異不是「呈現少」，而是**資料源完全不同**：

| 指標 | 數量 | 後台顯示？ |
|---|---|---|
| `checkup_knowledge_hits`（真實用戶命中） | **0 筆** | 是 → 後台每條都顯示「未被使用」✅ 沒錯 |
| `checkup_knowledge_hits` 近 7 天 | **0 筆** | 是 |
| `checkup_knowledge_validations`（自動回測產生） | **547,041 筆** | ❌ 後台沒顯示 |
| `knowledge_backtest_runs`（自動回測批次） | **39,850 筆**（近 8 天每天 3k–7k） | ❌ 後台沒顯示 |

**結論**：後台沒騙你 — 真正用戶端對知識庫的命中是 **0**。把 DB 撐爆的是「自動回測系統」自己在 spam，跟使用者一點關係都沒有。元兇是 `knowledge-full-audit` 在背景觸發 `knowledge-backtest`、加上 `knowledge-daily-scheduler` 每日跑 20 條 backtestable + 5 條 grid search，但 `knowledge-backtest` 內部會展開成「每條 × 多檔股票 × 多 horizon」→ 每天產生數千筆 run。

---

## 計畫（3 件全做 + 補後台可見性）

### Step 1：DB 清理（一次性，馬上釋放 IO/空間）

執行 SQL：
1. `checkup_knowledge_validations` — **刪除 30 天以前**的紀錄（保留近 30 天供統計）。預估刪除 ~500k 筆，釋放 ~150 MB。
2. `knowledge_backtest_runs` — **刪除 14 天以前**的 run（保留近 14 天供後台「淘弱加強」面板用）。預估刪除 ~30k 筆，釋放 ~12 MB。
3. `daily_price_snapshots` — `VACUUM FULL` 釋放 dead tuples（3.4 MB → 預估 < 100 KB）。
4. 加索引：`checkup_knowledge_validations(created_at)`、`knowledge_backtest_runs(created_at)`，讓後續清理不再 full scan。

### Step 2：本地 vs 雲端知識庫對齊

問題：本地 JSON 只有 25 條，雲端 488 條（含後台陸續新增/Claude 起草的）。
做法：執行 `node scripts/sync-knowledge-base.mjs --apply`，把本地 25 條 upsert 上去（已存在的會 bump version、本地沒有的雲端條目會保留不刪）。**這個腳本是單向 local→cloud，不會洗掉雲端資料**。

### Step 3：後台補「真實使用量 + 自動回測活動」面板

在 `src/pages/company/KnowledgeBase.tsx` 的標題列下方加一條 **總覽卡**，顯示：
- 真實命中：累計 0 / 7 天 0（讓你一眼看到「沒人用」）
- 自動回測：累計 39,850 run / 7 天 35k run（讓你看到 IO 元兇）
- 驗證樣本：累計 547k / 7 天 483k
- 各 lifecycle 計數：active 305 / rescue 90 / archived 93
- 「打開排程說明」按鈕，連到 SystemJobs 頁面

附帶在 lifecycle filter 旁邊加一個「歸檔」勾選，讓你可以看到 93 條 archived（目前預設不顯示，所以你會以為「沒這麼多」）。

### Step 4（可選，本回合不做，等 Step 1 觀察 24h 再決定）

- `knowledge-backtest` 改成 **upsert on `(knowledge_item_id, stock_code, horizon_days)`** + 限制單次最多 N 個 stock，預估每日寫入從 ~70k → 數百筆。
- `knowledge-full-audit` 改成「先檢查上次 backtest 是否在 7 天內，若是就跳過」，避免重複觸發。

---

## 給你決定的兩件事

**Q1：清理保留期能接受嗎？**
- validations 保留 30 天（樣本數已遠超 `min_sample_size=30`，足夠統計）
- backtest_runs 保留 14 天（後台「淘弱加強」面板只看最近表現）

**Q2：要把 `knowledge-full-audit` 的背景 backtest 觸發暫時停掉嗎？**（避免清理完又被 spam 滿）
- 建議：暫停 7 天，期間靠 `knowledge-daily-scheduler` 的 20 條/日 限額餵就好。
- 暫停方式：在 `knowledge-full-audit` 加個 feature flag，預設 false，要跑時手動開。

如果你都 OK，回「都好」我就直接 Step 1+2+3 一次做完。
