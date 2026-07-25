
# V4 完整施作步驟 —— 逐 PR 執行手冊（含 bug 風險預判）

每個 PR 都遵循 **證據 → 遷移 → 程式 → 測試 → 灰度 → 監控 → 回滾** 七段結構。所有 SQL 用 migration tool；資料操作用 insert tool；不動 `src/integrations/supabase/*`。

---

## PR-0（前置）：契約表、feature flag、觀測骨架

**必須先做，否則後面 PR 沒地方寫覆蓋率、沒法灰度、沒法回滾。**

### 遷移
- 新表 `data_source_health`：`source, ok_count_10m, fail_count_10m, p95_latency_ms, consecutive_failures, circuit_state, disabled_until, last_error_code, updated_at`。
- 新表 `institutional_new_stock_queue`：`stock_id UNIQUE, requested_at, attempts, next_attempt_at, status, last_error`。
- `tw_bsr_sync_config` 新增 rows：`cold_start_status`、`keep_warm_schedule`、`circuit_breaker_config`、`fastlane_enabled`、`ui_state_machine_enabled`。
- 新 RPC `get_coverage_stats(scope text, window_days int)` → 回 `(total_stocks, ready, filling, missing)`；只 SELECT，`SECURITY DEFINER`。
- 新 view `v_active_tw_holdings`：抽取「所有活躍持倉的台股 4 碼」單一來源，供所有 job 共用。

### Bug 風險與對策
| 風險 | 對策 |
|---|---|
| 4 碼判定散落多處，未來又出權證截碼 bug | `v_active_tw_holdings` 用正則 `^[1-9][0-9]{3}$` 統一，所有 job 只讀此 view |
| flag 名混亂 | 只用 `tw_bsr_sync_config.key` 一張表，命名 `cold_start_*` / `keep_warm_*` / `fastlane_*` / `ui_*` 前綴 |
| 表建了但沒 GRANT | 每張表照憲法 4 段結構 |

### 驗證
- `supabase--linter` 通過。
- `SELECT count(*) FROM v_active_tw_holdings` 手動比對 `trade_records` 應相等。

---

## PR-1：一次性冷啟動（**本 PR 讓使用者當週看到答案**）

### 證據
- 已驗：`tw_institutional_daily` 只 6 日、`tw_bsr_daily` 只 302 檔。
- 決策：三大法人 60 日走 TWSE/TPEx bulk（0 quota），BSR 60 日走 FinMind Market Batch（~60 quota）。

### Edge Function
- 擴充 `tw-institutional-daily-sync`：加入 `mode=cold_start&days=60&dry_run=<bool>`。
  - Loop 過去 60 個「交易日」（跳過假日：拿 `tw_bsr_daily.trade_date DISTINCT` 作為交易日集，若不足則 fallback 到「週一至週五 minus 已知節假日常量」）。
  - 每 request 間 sleep 1200ms（TWSE 限速；不能砸）。
  - 只 upsert，`source='twse_bulk'`，不覆蓋既有 `source='finmind_*'` 的更精細資料。
- 新 Edge Function `tw-bsr-cold-start-holdings`：對 `v_active_tw_holdings` 讀出的 stock set，用 FinMind Market Batch 逐日抓 60 日；每日只 1 quota。
  - 走現有 `fetchWithRateLimit`（tier=3，最低優先，避免壓過使用者即時需求）。
  - **原子性**：以 `tw_bsr_sync_config.cold_start_status = {started_at, days_done, days_total, cursor_date}` 追蹤斷點，可安全重跑。
- Admin 觸發入口：`BsrRateLimit.tsx` 加兩顆按鈕（各自帶 dry-run 預估）。

### Bug 風險與對策
| 風險 | 對策 |
|---|---|
| Dry-run 呼叫數估錯，真跑爆 quota | 預估邏輯集中於單一 helper `estimateColdStartCost()`，同時用於 dry-run 顯示與 pre-flight 檢查；若 quota 剩餘 < 估算 × 1.5 → 拒絕啟動並提示等待 |
| 中途失敗留下混合狀態 | 每日一個 chunk，寫入 `cold_start_status.days_done` 後才推進；重跑從 cursor 續 |
| TWSE 端假日邏輯錯，多抓空日浪費 | 判斷回應 `data===[]` 且 `stat` 含「無資料」→ 直接標記為假日跳過，不重試 |
| 觸發後管理員關瀏覽器 → job 停 | 用 `pg_net.http_post` 非同步觸發（不依賴瀏覽器保活） |
| 重覆按按鈕 | `cold_start_status.state IN ('running','done_recent_24h')` 時按鈕 disabled + 顯示原因 |
| upsert 覆蓋更好的資料 | source 優先級：`twse_official > tpex_official > finmind_market_batch > finmind_per_stock`；upsert 走 RPC 做優先級比較，不用 `ON CONFLICT DO UPDATE` |

### 測試
- Unit：`estimateColdStartCost` 對 5/30/60 日輸入的預期成本表。
- Deno 契約測試：`tw-institutional-daily-sync?mode=cold_start&dry_run=true` 回傳 `{estimated_calls, estimated_quota}` 且不真的 fetch。
- 手動驗收：staging 先跑 dry-run，確認估算合理，再真跑，最後 SQL 驗 `tw_institutional_daily` date count ≥ 55、`tw_bsr_daily` stock 覆蓋率 ≥ 95%。

### 灰度
- Staging 全跑完再上 prod。
- Prod 先跑三大法人（0 quota，無風險），確認 dashboard OK 再跑 BSR。

### 回滾
- 冷啟動 job 只寫入不刪除。若資料錯，可 `DELETE FROM tw_institutional_daily WHERE source='twse_bulk' AND trade_date >= X` 反刪。

---

## PR-2：移除 FinMind 品牌 + CI audit

### 檔案清單（已 grep 過至少 8 處）
- `src/checkup/components/freecheckup/ChipsSection.tsx`：footer caption、backfill button 文案。
- `src/checkup/components/freecheckup/ChipsTrendChart.tsx`：tooltip、readiness 文案。
- `BsrRateLimit.tsx` 儀表板：改為「上游 A」「上游 B」或「即時來源／深度來源」。
- `docs/ops/bsr-finmind-runbook.md`：內部文件保留 FinMind 字樣（僅工程用）。
- 資料來源欄位改顯示官方名：`臺灣證券交易所 / 證券櫃檯買賣中心`。

### 新 audit script `scripts/audit-vendor-branding.mjs`
- AST 掃 `src/` 下所有 `.tsx/.ts`，禁止字面字串出現 `FinMind`、`finmind`、`TWSE ` 開頭直接對使用者。
- 允許清單：`supabase/functions/**`、`docs/**`、`scripts/**`、`.github/**`、單元測試檔案。
- CI workflow `.github/workflows/vendor-branding-audit.yml`。

### Bug 風險
| 風險 | 對策 |
|---|---|
| 動態字串拼接繞過 audit | script 也偵測 `` `...${...}...FinMind...` ``、`i18n` key 命名 |
| i18n 檔漏改 | grep locales/ 資料夾一次 |

---

## PR-3：Keep-Warm cron 3 波 + 覆蓋率表

### 遷移
- 新表 `tw_institutional_coverage`：`stock_id, trade_date, source, has_data BOOL`。用 trigger 於 `tw_institutional_daily` insert/update 時自動維護。
  - 若寫盤壓力大，改用每小時 refresh 的 mat view（先 trigger 模式，出現效能問題再切換）。
- 新 RPC `get_institutional_coverage(scope='active_holdings', window_days=60)` → readiness stats。

### Cron 設定（用 insert tool 執行，非 migration）
- 使用 `pg_cron.schedule` 三筆（含 anon key，不入 migration）。
- 15:30 / 17:30 / 19:30 分別呼叫 `tw-institutional-daily-sync?mode=today` 與 `tw-bsr-finmind-sync?mode=market_batch_today`。
- **時區 pin 到 UTC+8**：cron 用 UTC 表達，加註解對照台北時間。

### Edge Function
- `tw-institutional-daily-sync?mode=today`：只抓當日，若 TWSE 尚未發布則寫 `data_source_health.consecutive_failures++` 並排入 17:30 重試。
- 每晚 02:00 新 job `tw-coverage-self-heal`：掃 coverage < 90% 的活躍持倉，補齊；單晚上限 20 個 (stock × 日) 組合。

### Bug 風險
| 風險 | 對策 |
|---|---|
| cron 三波都失敗 → 當日空白 | Fallback 契約由 PR-6 前端狀態機顯示 D-1，不會空白；同時 SLA 監控 alert |
| coverage 觸發器拖慢 write | 只 index `(stock_id, trade_date)`，trigger 內邏輯僅 upsert 一 row；壓測若 > 5ms → 切 mat view |
| self-heal 單晚上限被卡住 → 永遠補不完 | 上限做成 `LEAST(20, count_of_missing * 0.2)`，缺越多補越多；並在 dashboard 顯示 ETA |
| 03:00 執行 self-heal 與 02:00 cold_start_status 未鎖 → 撞車 | 用 `pg_try_advisory_lock` 互斥 |

### 監控
- `data-ops` dashboard 顯示三波 cron 各自的最近成功時間、失敗次數。
- 覆蓋率跌破 95% → 送 `system_alerts`。

---

## PR-4：資料品質閘道 + source 欄位

### 遷移
- `tw_institutional_daily` 加 `source TEXT NOT NULL DEFAULT 'unknown'`、`quality_flags JSONB DEFAULT '{}'`。
- 新 RPC `upsert_institutional_with_gate(rows JSONB, source TEXT)` 集中檢查：
  1. Schema：required fields。
  2. Range：|total_net| < 流通股本 × 10%（流通股本從 `stock_names` 讀）。
  3. Consistency：三大法人加總 = total_net ± 1000 股。
  4. Source priority：現有 row source 較高則不覆蓋。
- 髒資料寫 `data_source_health.last_error_code = 'quality_gate_failed'` + `system_alerts`。

### Bug 風險
| 風險 | 對策 |
|---|---|
| 舊資料無 source 欄，upsert 全部被擋 | migration 中 `UPDATE ... SET source='legacy_backfill'` 一次補齊 |
| Range 檢查誤殺 ST 股 / 新股（流通股本未知） | 若 `stock_names.outstanding_shares IS NULL` → 只做 schema + consistency 檢查，不做 range |
| Priority 表死板，未來新來源要改程式 | 用 `data_source_priority` 表配置，不寫死 |
| 檢查慢拖累 sync throughput | 檢查在 RPC 內用 set-based SQL，不 loop |

---

## PR-5：新股 fast-lane

### 遷移
- `trade_records` AFTER INSERT trigger `enqueue_new_stock_data`：
  - 若 stock 4 碼且 `tw_institutional_daily` 近 30 日 rows < 5 → INSERT INTO `institutional_new_stock_queue`（ON CONFLICT DO NOTHING）。
  - BSR 走現有 enqueue 機制。
- Edge Function `tw-new-stock-fastlane`：每 60 秒由 cron 觸發，消化 queue，走 FinMind per-stock（tier=1，最高優先）。

### UI（PR-6 一起實作）
- 抽屜偵測到 `institutional_new_stock_queue.status='running'` → 顯示「新股資料建立中，剩餘約 N 分鐘」。

### Bug 風險
| 風險 | 對策 |
|---|---|
| Trigger 內做網路呼叫（不能）| Trigger 只寫 queue，worker 才呼叫 |
| 老股被誤判為新股（歷史資料剛好缺）| 判定條件加：`(SELECT max(trade_date) FROM tw_institutional_daily WHERE stock_id=X) < current_date - 30` 才算新股 |
| Queue 卡死（一直失敗）| `attempts >= 5` 且最後錯誤為 4xx → status='dead'，寫 alert；5xx 走指數退避 |
| Fastlane 搶掉 keep-warm quota | tier=1 有 quota reservation，但單日上限 `min(50, active_holdings * 0.05)` |
| 新股冷啟動 60 日一次呼叫太重 | Fastlane 只補「近 20 日」讓 5/20 日視窗立即可用，60 日由當晚 self-heal 續完 |

---

## PR-6：前端 5 狀態機 + 預熱 cron

### 前端
- `ChipsTrendChart.tsx` + `ChipsSection.tsx` 收斂到單一 hook `useChipsState()`：
  - Input：`{ready, filling, upstream_exhausted, no_data}` 加 backend `fallback_used`、`fastlane_running`。
  - Output：明確 5 個 state。
- 各 state 對應 UI 樣式集中在 `chipsStateView.ts`（避免散落）。

### 預熱 cron
- 19:35 job `warm-chips-cache`：對 `v_active_tw_holdings` 呼叫 `tw-chips-detail` 預熱記憶體快取（限速 5 req/s，避免自 DoS）。

### Bug 風險
| 風險 | 對策 |
|---|---|
| 5 狀態互斥判定錯誤（同時 ready + fastlane_running）| hook 內用 discriminated union，TypeScript 強制互斥 |
| 預熱把 edge function 打掛 | 預熱走內部 route（不經 CDN），5 req/s，可用 `sync_config.warm_enabled` kill switch |
| 前端 loading spinner > 3s 出現在使用者面前 | 加 E2E `assert loading_time < 3000ms` |
| 舊使用者已快取的畫面被錯誤覆蓋 | React Query key 加 `state` 版本，state 變動才 invalidate |

---

## PR-7：熔斷 + `data_source_health` UI

### Edge Function 共用工具 `_shared/circuitBreaker.ts`
- `withCircuit(source, fn)` wrapper：讀 `data_source_health`，Open 時直接 throw；Half-Open 只允許 1 探針。
- 所有 TWSE / TPEx / FinMind 呼叫改走 wrapper。

### Bug 風險
| 風險 | 對策 |
|---|---|
| 狀態機 race（多 edge function 同時寫 health）| 用 RPC `record_source_call(source, ok bool, latency_ms)` 集中原子更新 |
| Half-Open 時多個 concurrent 探針 | 探針用 `pg_try_advisory_xact_lock` |
| 熔斷太敏感 → 阻斷正常流量 | 門檻可調（`circuit_breaker_config`），預設連 3 失敗 + 10 分鐘窗口成功率 < 50% |
| 熔斷永不恢復 | 每 30 分鐘強制送 1 個探針 |

---

## PR-8：FinMind Quota 三 Pool + Admission

### 設計
- 現有 `finmindRateLimit.ts` 已支援 tier。改為三個 named pool：
  - `pool_realtime` (tier=1)：使用者觸發的 fastlane、當日 keep-warm。60% 額度。
  - `pool_backfill` (tier=2)：coverage self-heal、冷啟動續跑。30% 額度。
  - `pool_diagnostic` (tier=3)：admin 手動診斷。10% 額度。
- Admission control：低優先 pool 用完時，禁止跨 pool 借用（防低優先淹沒高優先）。

### Bug 風險
| 風險 | 對策 |
|---|---|
| 高優先 pool 用不滿而低優先被卡 | 每小時最後 10 分鐘允許 tier=2 借用 tier=1 剩餘 |
| Pool 統計飄移（reservation lease 過期未回收）| 現有 lease/expiry 機制已解，加 sweep job 每 5 分鐘清 expired |

---

## PR-9：測試金字塔 + Runbook + 上線

### E2E 檔案清單
- `e2e/chips-new-user-sla.spec.ts`：mock 新使用者、加持倉、驗抽屜 < 500ms 且 5/20/60 日 ready。
- `e2e/chips-new-stock-fastlane.spec.ts`：mock 新上市股 → 顯示 fastlane 文案 → 5 分鐘完成。
- `e2e/chips-upstream-outage.spec.ts`：mock 全來源熔斷 → 顯示 D-1 badge，不空白。
- `e2e/chips-no-vendor-brand.spec.ts`：整頁 accessible text 掃無「FinMind」。
- 負載：staging 用 k6 或簡單 loop，1000 並發抽屜開啟，斷言 FinMind API 呼叫數 = 0。

### CI workflow
- 新增 `.github/workflows/chips-integrity.yml`：跑 vendor branding audit + chips E2E + Deno test。

### Runbook
- 新增 `docs/ops/chips-data-runbook.md`：冷啟動觸發 SOP、熔斷手動重置、pool 用量診斷、fastlane queue 清理。

---

## 通盤 Bug 風險矩陣（跨 PR）

| 類別 | 風險 | 兜底 |
|---|---|---|
| **時區** | cron 用 UTC，開發者以為台北時間 | 所有 cron 註解標 UTC 與台北，helper `formatTaipeiDate` 已存在 |
| **交易日曆** | 假日誤判抓空 | 集中在 `_shared/tradingCalendar.ts`，單一函式 `isTradingDay(d)` |
| **股票代號** | 4 碼、6 碼權證、5 碼 ETF 混淆 | `v_active_tw_holdings` view 唯一來源，正則憲法化 |
| **併發** | 多 edge function 同時寫 health/quota | 全部走 RPC + advisory lock |
| **回滾** | migration 失敗鎖 DB | 每個 PR 附 down migration；新表可安全 DROP |
| **成本失控** | quota 因 bug 暴衝 | 三 pool 硬上限；alert 於 80% 觸發 |
| **UI 空白** | 任何 state 未涵蓋 | 5 狀態機用 discriminated union；default case throw（開發期）+ 顯示 fallback（生產） |
| **快取污染** | 冷啟動寫入未清舊快取 | 冷啟動完成後主動 bust `tw-chips-detail` in-memory cache（PR-3 附帶） |
| **View-as 模式** | 管理員以會員身份看到快取被污染 | 快取 key 已含 effective user id；PR-6 hook 沿用 |
| **RLS** | 新表被前端讀取失敗 | 全部經 edge function + service_role，前端不直讀（除了 `data-ops` 給 admin） |

---

## 為什麼這份步驟可執行且不易產生 bug

1. **PR-0 先建骨架**，後面所有 PR 只填肉，不改結構。
2. **每個 PR 都有 dry-run + 灰度 + 回滾**，任何一步壞了都能秒切回舊行為。
3. **單一來源憲法**：`v_active_tw_holdings`（股票）、`upsert_institutional_with_gate`（寫入）、`useChipsState`（前端）、`withCircuit`（呼叫）、三 pool（quota）、`tradingCalendar`（假日）—— 六大關鍵點各只有一份實作。
4. **CI 護欄**：vendor branding audit、LOC 上限、E2E SLA 斷言，任何回歸自動擋。
5. **PR-1 先給價值**：當週跑完冷啟動使用者就能受益，其他 PR 全是「讓這件事持續成立」的守護。
