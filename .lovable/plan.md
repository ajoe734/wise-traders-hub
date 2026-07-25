
## 完善版：Snapshot-First 全市場籌碼資料庫

新增缺漏：**Canonical Schema、寫入契約、跨源仲裁規則、備援機制、法遵、階段閘門、觀測、DR**。

## 1. Canonical Schema（單一事實表 + 派生表）

```
── 事實層（immutable append） ──────────────
tw_chip_fact(stock_id, trade_date, source, broker_id,
             buy_shares, sell_shares, ingested_at, PK(所有))
   ⌙ append-only；三 Lane 各自寫，同 key 不覆蓋

── Canonical 層（1 stock × 1 day = 1 row）──
tw_bsr_daily(stock_id, trade_date, broker_id, ...)
   ⌙ 由仲裁器從 tw_chip_fact 產出，UPSERT with sealed guard
tw_institutional_daily(stock_id, trade_date, foreign/inv/dealer_net, ...)
   ⌙ 三大法人 canonical

── 派生層（讀優化） ────────────────────────
tw_chips_rollup(stock_id, trade_date, window=5|20, top5_net_ratio,
                sealed_at, source_lane)
   ⌙ 純聚合，讀延遲 < 50ms

── 狀態層 ─────────────────────────────────
tw_bsr_daily_snapshot_status(trade_date, sealed_at, sealed_by_lane,
                             coverage_stocks, coverage_brokers,
                             lane_a_status, lane_b_status, lane_c_status)
data_source_health(lane, last_success_at, consecutive_fail, p95_latency)
```

**Immutability 契約**：DB trigger 攔 `UPDATE`；`sealed_at IS NOT NULL` 的日期 canonical 只讀。Admin 需 `force_reseal_reason`。

## 2. 三 Lane 寫入契約

| Lane | 寫入路徑 | Idempotency Key | 失敗處理 |
|---|---|---|---|
| A FinMind batch | `tw_chip_fact`（source='finmind_batch'）| (stock,date,broker,source) | quota 用盡 → skip，不 fail whole |
| B TWSE BFI82U | `tw_institutional_daily` | (stock,date,inst_type) | 官方 5xx → 30 分退避重試 |
| C TPEx bulk | 同上 | 同上 | 同上 |
| D T86 | 同上 | 同上 | 交叉驗證用 |
| E Broker scraper | `tw_chip_fact`（source='broker_XXX'）| 同 A | 尊重 robots；失敗 alert 不重試 |

**所有 Lane 都是無狀態 producer**，Orchestrator 是唯一 consumer 決定 seal。

## 3. 仲裁與異常偵測（Reconciliation）

**Seal 條件（AND）**：
- `coverage_brokers >= 5`（分點）
- `sum(buy_shares) - sum(sell_shares)` 誤差 < 1%（買賣平衡）
- Lane A 分點合計 vs Lane B/C/D 三大法人合計，差異 < 5%
- 上述通過 → `snapshot_status.sealed_at = now(), sealed_by_lane = 'A'`

**Anomaly 分級**：
- L1（自動修）：某 Lane 缺、其他 Lane 全 OK → 直接 seal，記錄 `partial_lanes`
- L2（延後 seal）：Lane 間差異 5-15% → 觸發 Lane E broker scraper 補驗
- L3（人工）：差異 > 15% 或全 Lane fail → 寫 `system_alerts`、Line 通知 admin、UI 顯示「當日整備中」

## 4. 三種管線 × 完全分離

| 管線 | 觸發 | Pool | 用途 |
|---|---|---|---|
| **Live**（每交易日 3 波）| cron 15:30/17:30/19:30 | interactive/keepwarm | 當日 seal |
| **Backfill**（20 日窗口）| daily 00:00 UTC + 手動 | backfill | 補缺日 |
| **Reconcile**（週日）| weekly | backfill | 20 日窗口一致性掃描 + 重跑 L2 |

三者用不同 quota pool，互不搶配額。UI 有 kill switch 個別關閉。

## 5. 讀路徑契約（前台永不觸發外部）

- Frontend → `tw-chips-detail`（Edge）→ 只 SELECT canonical 三表 + `snapshot_status`。
- 狀態映射：
  - `sealed`：正常顯示
  - `partial`：顯示已有 Lane 資料 + 「⚠ 分點資料整備中」小標
  - `missing`（非交易日）：顯示「休市」
  - `stale`（>2 交易日未 seal）：顯示紅色警示 + 上一交易日資料
- **移除**所有前台 `ensure_bsr_window` / `enqueue` 觸發路徑；改由 Orchestrator 單向 push。

## 6. 成本 & Quota 治理

| Guardrail | 值 | 動作 |
|---|---|---|
| FinMind 月度上限 | 100 calls | 超過 → Lane A 自動熔斷至月末 |
| Broker scraper 日上限 | 200 pages | 超過 → Lane E 熔斷 24h |
| Lane 連續失敗 | 3 次 | 降級到 secondary Lane + alert |
| Snapshot lag | > 2 交易日 | Sev1 alert，Line + Email |

所有 threshold 存 `system_kill_switches`，UI 可調。

## 7. 法遵 / ToS

- **FinMind**：sponsor plan ToS 明確允許 batch，OK。
- **TWSE/TPEx 官方**：公開資料無授權疑慮，但**必須加 User-Agent 標識** + 遵守請求間隔（>1s）。
- **Broker 官網 scraper**：只抓公開分點頁、尊重 robots.txt、每域名 3s 間隔、每日上限 200 頁、有 kill switch。實作前 review 三家目標網站 ToS，任一禁止則移除該來源。

## 8. 觀測 / SLO

**`/company/data-source-health` 儀表板新增**：
- 三 Lane 狀態燈 + 過去 30 天 uptime%
- 20 日窗口熱圖（每日 × 每 Lane 是否 sealed）
- 月度呼叫用量計數（FinMind quota / scraper pages）
- p95 讀延遲（前台 → DB）
- Reconciliation 差異 histogram

**SLO**：
- 讀 p95 < 400ms
- 交易日 T+3h（17:30）之前 seal 率 ≥ 95%
- Lane A 月度呼叫 ≤ 30

## 9. 災難復原（DR）

- FinMind 全掛 → 分點 24h 不更新；三大法人由 Lane B/C/D 頂上；UI 顯示 partial。
- TWSE 全掛 → 三大法人 24h 不更新；分點由 Lane A/E 提供；UI 顯示 partial。
- DB 資料損毀 → `tw_chip_fact` 是 SoT，可重跑 Reconcile 重建 canonical。
- 全部外部掛 → 前台仍能顯示 20 日 sealed snapshot（因為是 immutable DB 讀）。

## 10. Rollout 階段閘門

| 階段 | 交付 | 閘門 |
|---|---|---|
| **P1** 基座 | Canonical schema + immutability trigger + `tw_chip_fact` + 遷移現有資料 | schema 遷移不掉資料 |
| **P2** Orchestrator + Lane A/B/C/D 灌水 | 3 波 cron + 仲裁器 | 連續 3 交易日 seal 成功 |
| **P3** 前台契約收斂 | 移除所有前台觸發、改純 DB 讀 | 10k concurrent 壓測通過 |
| **P4** Lane E scraper | broker 官網 fallback + kill switch | 法遵 review 通過 |
| **P5** Reconcile + 觀測 | 週日對帳 + 儀表板 + SLO alert | 一週實測 SLO 達標 |

每個階段可獨立 rollback（feature flag）。

## 11. 測試矩陣

- **Unit**：仲裁器邊界（誤差=4.99% seal / =5.01% partial）、immutability trigger 阻擋、Lane E robots 遵守。
- **Integration**：模擬 Lane A 掛，驗 seal 走 B/C/D 且 UI 標 partial。
- **E2E**：抽屜對 5 檔任意股（活躍/冷門/新上市/警示/停牌）都能秒開。
- **Load**：k6 10k concurrent → 外部呼叫增量 = 0、DB p95 < 400ms。
- **Chaos**：kill FinMind token / kill TWSE endpoint，驗 DR 行為。

## 前置決策（一項就好）

FinMind sponsor token 是否已升級？沒升級的話 P2 Lane A 只能靠 date-range 首發 1 次 + Lane E scraper 補當日，成本結構會不同（scraper 負載增加）。

## 交付定義

- 20 日 × 全市場 sealed 覆蓋 ≥ 98%
- 前台讀 p95 < 400ms、10k 並發外部呼叫增量 = 0
- 任一單 Lane 停擺 24h 前台不 fail
- 月度付費 quota ≤ 30
- 每一階段可獨立回滾
