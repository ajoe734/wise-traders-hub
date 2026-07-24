## 對前一版計畫的自我批判

前版把「改 `tw-chips-detail` 序列來源」當單點修法，還有 5 個更深層漏洞沒處理：

1. **假設未驗證**：說是 PostgREST `max-rows=1000` 截斷，但沒實測。可能是 Supabase JS client 內部分頁、也可能是 Deno fetch memory 超限提早中斷。**根因未鎖死就動刀等於猜謎**。
2. **讀時聚合仍在**：即使改讀 rollup，只要 rollup 沒有「每個 trade_date 一列」的日粒度，Edge Function 還是得回頭撈 raw 現算 → 同樣的 row-cap 陷阱換個表再犯一次。
3. **無防呆合約**：修完之後，下一次任何人再寫「.select().limit(N)」對高基數表都會踩同個地雷。缺少 payload-level invariant + CI 契約測試。
4. **快取毒化**：5 分鐘 memoryCache 是 per-instance；修好後至少 5 分鐘 + N 個 warm instance 仍供舊 payload。無版本鍵、無主動失效。
5. **讀寫責任錯位**：`broker_count` / `low_quality` / `top15_ratio` 屬於「寫入時就該定案的事實」，卻在讀取每次現算，浪費 CPU、產生不一致的可能。

## 升級後的計畫（Snapshot-First × Write-Time Fact × Contract Invariant）

### 步驟 0 — 先鎖根因（不改 code）

在動任何一行前，用二分法確認截斷邊界：
- 對 3443 呼叫 `tw-chips-detail`，同時直接 `supabase-js` client 用 service key 打 `tw_bsr_daily.eq(stock_id).limit(N)`，N = 500 / 1000 / 1500 / 3000。
- 記錄回傳 row 數 vs 涵蓋 trade_date 數，證實截斷點在哪、是 PostgREST server-side cap 還是 client-side range。
- 這一步落成 `docs/ops/bsr-rowcap-probe.md`，之後每季重跑一次防漂移。

### 步驟 1 — 建立「日粒度事實表」`tw_bsr_daily_summary`

一日一列、每檔一列，寫入時就定案。欄位：
```
stock_id, trade_date, broker_count, low_quality (bool),
top15_net_shares, total_buy_shares, concentration_ratio_top15,
foreign_net, trust_net, dealer_net,   -- 順便鎖三大法人合併
computed_at
```
- 由 `tw-bsr-finmind-sync` worker 在 `persistAggregated` 尾巴同 transaction 寫入（AFTER 寫 raw + rebuild rollup）。
- 加 unique index `(stock_id, trade_date)`，`ON CONFLICT DO UPDATE`。
- **一次性 backfill**：跑一支 admin RPC `backfill_bsr_daily_summary(since date)`，把現有 raw 全部灌完。

### 步驟 2 — `tw-chips-detail` 只讀 summary，不再撈 raw

```
select ... from tw_bsr_daily_summary
  where stock_id = $1
  order by trade_date desc
  limit 60
```
- 60 列 << 任何 row cap，永久免疫。
- Fallback (top_buy/top_sell) 仍需 raw 但**只讀最新 fallbackAsOf 那一天** → `.eq(trade_date, X)` → 一天上限一千多列、可控。
- Readiness 改由 `tw_bsr_daily_summary` 的日期集 + `tw_bsr_upstream_probe.exhausted` 決定，與 series 使用同一資料源，消除「畫面 have=2 但 series=5」這種永遠可能發生的錯位。

### 步驟 3 — Payload-level Invariant + 契約測試

在 Edge Function 回傳前加 assertion：
```
if (readiness.5.have !== series.filter(p=>p.concentration!=null).length) {
  console.error('READINESS_SERIES_MISMATCH', { stockId, ... });
}
```
CI 契約測試：
- `src/test/integration/tw-chips-detail-rowcap.test.ts`：mock summary 60 列 + raw >5000 列 → 斷言 series.length=60、readiness.have=60。
- `e2e/chips-section.spec.ts` 追加：帶「高基數股（>500 brokers/day）」fixture，斷言 `data-readiness-have === series 圓點實心數`。
- `docs/qa/bsr-invariants.md`：文字化 3 條不變量（have=series 有效點數；rollup.d5 存在 → summary 至少 5 列；exhausted → have<need 但 state=upstream_exhausted）。

### 步驟 4 — 快取版本化 + 主動失效

- Cache key 從 `chips:${stockId}` 改成 `chips:${stockId}:${summaryLatestAsOf}`；如此新資料寫入自動 miss，5 分鐘 TTL 保留只為短時間重複請求。
- Sync worker 完成 `persistAggregated` 後，publish 一則 `pg_notify('bsr_updated', stock_id)`；Edge Function 訂閱後主動清掉 stock 對應 key（optional，但把「不新鮮」從 5 分鐘降到秒級）。

### 步驟 5 — 觀測與退場條件

- 新增 metric：`bsr_readiness_series_mismatch_total`（步驟 3 assertion 命中次數），寫入 `function_run_logs` 供 `/company/bsr-rate-limit` 儀表板展示。
- 上線後 7 天內若 mismatch > 0 → 自動 alert 到 system_alerts；14 天 = 0 才視為成功、關閉這個工單。

## 為什麼這比前版強

| 面向 | 前版 | 升級版 |
|---|---|---|
| 根因驗證 | 假設 max-rows=1000 就動手 | 步驟 0 二分法先鎖 |
| 讀取複雜度 | O(days × brokers) → 動輒 40k rows | O(days) = 60 rows |
| 一致性 | series/readiness 由不同來源推 | 單一 summary 表 |
| 回歸防禦 | 加測試 | 加 invariant + assertion + alert |
| 快取正確性 | 5 分鐘可能供舊資料 | 版本鍵，寫入即失效 |
| 未來擴充 | 每加一個窗口都要重撈 raw | summary 已含全部欄位、O(1) 加欄 |

## 技術細節（新舊差異一目瞭然）

- 新表：`public.tw_bsr_daily_summary` + 對應 `GRANT SELECT ON ... TO authenticated;`（policy `authenticated_read`）。
- 動的 edge functions：`tw-bsr-finmind-sync/index.ts`（寫入 summary）、`tw-chips-detail/index.ts`（改讀 summary + payload assertion + 快取版本化）。
- 新 RPC：`backfill_bsr_daily_summary(since date)`（一次性）、`get_bsr_readiness(stock_id)`（讀 summary + probe，回傳 5/20/60 window 狀態，取代 Edge Function 內部組合）。
- 前端零改動（`ChipsSection` / `ChipsTrendChart` 只吃相同 payload 形狀）。
- 部署順序：建表 → backfill → 部署 sync worker（雙寫）→ 部署 chips-detail（改讀）→ 觀察 mismatch 為 0 → 撤除 raw 撈取分支。

## 給你的一句話

前版只是「換一個 SELECT」的補釘；升級版是「把日粒度事實提前寫死，讀取變 O(1)，並且用 invariant 永遠關掉這類 bug 的產生條件」。這才對得起 M1~M5 的 Snapshot-First 架構。