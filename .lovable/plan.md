
# 全庫過舊知識清理 — 回測 + 自動處置

## 現況（剛查的）

| Category | 啟用中 | last_validated_at > 90 天或 NULL | 從未驗證 |
|---|---:|---:|---:|
| chip_analysis | 96 | 90 | 90 |
| industry_trends | 98 | 92 | 92 |
| news_correlation | 91 | 87 | 87 |
| strategy_cases | 100 | 90 | 90 |
| technical_analysis | 97 | 94 | 94 |
| **合計** | **482** | **453** | **453** |

也就是說 **453 / 482（94%）** 的條目從未經過驗證或已超過 90 天未驗證。`knowledge_auto_rules.enabled=false`，所以過去自動淘汰／rescue 流程沒有真的在跑。

## 目標
依你選擇：
- 範圍：**5 個 category 全掃**
- 過舊門檻：`last_validated_at IS NULL OR < now()-90d`
- 動作：**清單 + 回測 + 套 auto_rules 自動處置**

## 執行步驟（Build mode 進入後）

### Step 1 — 產出過舊清單（SQL，幾秒）
寫入 `audit_logs`，並在 console 回報：
- 每個 category 的過舊筆數
- 樣本標題前 10 筆（讓你目視確認）

### Step 2 — 啟用 auto_rules 並校正門檻
你目前 DB 內的數值有點怪（`archive_below_win_rate=0.7`、`promote_above=0.85`），會把幾乎所有條目都判成 archive。建議調回業界合理值：

```text
enabled                    : true
archive_below_win_rate     : 0.40
promote_above_win_rate     : 0.70
auto_grid_search_below     : 0.55
min_sample_size            : 30
daily_grid_search_quota    : 5  （不變）
```

> 這一步我會用 migration 寫進去，**並在 plan approval 後先請你確認門檻數字**再執行。

### Step 3 — 批量回測 453 筆
複用既有的 `knowledge-backtest` edge function：
- 新增 `knowledge-backfill-runner` edge function（或擴充 `knowledge-daily-scheduler` 加 `mode=full_audit`），按 category 分批呼叫 `knowledge-backtest`
- 每批 20 筆、批間延遲 1 秒，避免打爆 AI Gateway / 行情 API
- 寫入 `knowledge_backtest_runs`，並更新 `checkup_knowledge_items.last_validated_at / win_rate / sample_size / backtest_run_at`
- 失敗的條目寫入 `audit_logs`（不阻擋整批）

預估時間：每筆 1.5–3 秒 × 453 ≈ **15–25 分鐘**，背景非同步跑、UI 顯示進度。

### Step 4 — 套用 auto_rules 自動處置
回測完，對每筆條目套規則：

```text
sample_size < 30                           → 維持 active，標記「樣本不足」
win_rate < 0.40 (archive 門檻)             → archive（is_active=false, lifecycle_status=archived,
                                              archived_reason='auto: low win_rate')
0.40 ≤ win_rate < 0.55                     → lifecycle_status=rescue, rescue_started_at=now()
                                              → 進入每日 grid search 池（daily_grid_search_quota=5）
0.55 ≤ win_rate < 0.70                     → 維持 active，下次例行回測
win_rate ≥ 0.70                            → promote: confidence ↑、last_validated_at=now()
```

每一筆都寫 `knowledge_backtest_runs.auto_action / auto_action_reason`，並寫一筆 `audit_logs`。

### Step 5 — 後台 UI 報告
在 `/company/knowledge-base`（`KnowledgeAudit.tsx`）新增一個 **「全庫審計報告」** tab：
- 本次審計的總覽（archived / rescue / promoted / kept 數量）
- 可下載 CSV
- 可逐筆看 before/after（win_rate、信心度、lifecycle_status）

### Step 6 — 通知
用上次新增的 `knowledge_sync_settings.notify_user_ids` 機制，發送 Resend Email + 後台站內信給指定管理員：「全庫審計完成：archived X 筆、rescue Y 筆、promoted Z 筆」。

## 技術細節

**新增檔案**
- `supabase/functions/knowledge-full-audit/index.ts` — 主 orchestrator，分批呼叫 `knowledge-backtest`，套 auto_rules
- `supabase/migrations/<ts>_knowledge_full_audit.sql` — 校正 `knowledge_auto_rules` 門檻 + 加 `enabled=true`
- `src/pages/company/knowledge-base/FullAuditReport.tsx` — 後台報告頁
- `src/pages/company/knowledge-base/StartFullAuditButton.tsx` — 觸發按鈕（含確認對話框）

**修改檔案**
- `src/pages/company/KnowledgeBase.tsx` — 加新 tab
- `src/checkup/lib/knowledgeBase.js` — Step 4 結束後呼叫 `resetKnowledgeBaseCache()`，使 active 改變立即生效

**安全**
- 只有 `company_admin` 能觸發（已有 RLS）
- 用 service role key 從 edge function 內部更新 items
- 全程寫 `audit_logs`

## 你按 Approve 後我會做的事

1. 跑 Step 1 SQL，把過舊清單列給你看（含每 category 前 10 筆樣本）
2. **暫停一次**請你確認 Step 2 的門檻數字
3. 部署 `knowledge-full-audit` edge function
4. 觸發背景任務，邊跑邊回報進度
5. 完成後產報告 + 寄通知 + 重置前端 cache

預期最終結果：482 筆會分成 **archived（過舊已淘汰）/ rescue（觀察中）/ active（重新驗證通過）**，AI 分析從此只餵新鮮、有實證的條目。
