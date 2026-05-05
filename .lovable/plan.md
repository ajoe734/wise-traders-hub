
# 績效圖三個都跑不出曲線的原因 + 修正計畫

## 一、根因（已驗證）

查 DB：`sharkgu` 共 3 筆 `trade_records`，**全部 `status='open'`**（達發 6526 / 智原 3035 / 晶豪科 3006，皆 2026/05/04 進場、尚未出場）。

而 `src/hooks/usePeriodPerformance.ts`（圖表唯一資料源）的查詢條件：

```ts
.in('status', ['closed', 'stopped'])
.not('pnl_percent', 'is', null)
```

→ 回傳 0 筆 → 三個圖（年/月/週）的所有 bucket `returnPct` 都是 0 → 累積線一路平 0%。

但上方 KPI「目前資產 $1,042,500 / 總報酬率 +4.25%」是用 `useExpertPerformance` 的 RPC 結果，**有納入未實現損益**，所以 KPI 看起來正常 → 兩邊資料源不一致，視覺上才會「圖空、數字飆」這種違和。

> 補充：「個股排名 / FloatingStatCard 表現最佳/最差」也吃同一支 hook，所以同樣抓不到。

## 二、修正方向（含未實現損益的每日/每月曲線）

把 `usePeriodPerformance` 從「只看 closed 的 pnl_percent 加總」改成「每個 bucket 結束時的『累積報酬率』snapshot」，未平倉的部位也要算進去。

### 2.1 改寫 `src/hooks/usePeriodPerformance.ts`

抓兩塊資料：
1. `trade_records` 全部（不再過濾 status），含 `entry_date / exit_date / entry_price / exit_price / quantity / current_price / instrument`。
2. `experts.starting_capital`（分母）。

對每個 bucket（週=日、月=日、年=月）的「結束日 D」算：

```text
已實現 PnL(D) = Σ ( (exit_price - entry_price) * quantity )  for trades with exit_date ≤ D
未實現 PnL(D) = Σ ( (markPrice(D) - entry_price) * quantity ) for trades with entry_date ≤ D < (exit_date or ∞)
累積報酬率(D) = (已實現 + 未實現) / starting_capital * 100
本期報酬率   = 累積(D) - 累積(前一個 bucket)
```

`markPrice(D)`：
- D 為今天 → 用 `current_price`（最後收盤）
- D 為過去 → 用 `entry_price`（保守 fallback；無歷史日線時不假裝有資料）

→ 這樣未平倉部位的「目前浮盈」會在最新一個 bucket 點顯示出來，曲線就會跳上來與 KPI 的 +4.25% 對齊。

### 2.2 個股排名 (top/bottom) 也要相容

`stocks[]` 裡每檔個股的 `returnPct` 用「該檔在此 bucket 區間內的累積報酬」（已平倉用實現；未平倉用浮動）。

### 2.3 跨頁一致性檢查

- `Dashboard.tsx / Performance.tsx / Profile.tsx / ExpertProfile.tsx / ExpertDetail.tsx` 皆使用 `PerformanceOverviewPanel` → 改 hook 即一次修好五處。
- KPI 條（起始資金 / 目前資產 / 總報酬率）與圖最終點誤差 ≤ 0.01%（同一公式）。

## 三、技術細節（給你 reference）

- 不動 `useExpertPerformance` RPC，避免再撞 SQL migration。
- `usePeriodPerformance` 內部全部用 `trade_records` 直查 + 純 TS 計算。
- 保留現有 bucket 標籤函式 (`getWeeklyTradingDays / getMonthlyTradingDays`)；年績效改用「最近 12 個月」label `YYYY/MM` 比較有意義（目前只有 1 筆月份，圖會只剩 1 點，符合「沒資料就一個點」）。
- 移除原本 `.in('status', ['closed','stopped'])` 與 `.not('pnl_percent', 'is', null)` 的過濾。

## 四、檔案清單

修改：
- `src/hooks/usePeriodPerformance.ts`（核心改寫）

驗證：
- 不需 DB migration。
- 重新整理 `/expert/sharkgu`：三個 tab 都應出現一條從 0% 上升到 +4.25% 的紅線，最新點 tooltip 與 KPI 一致。
