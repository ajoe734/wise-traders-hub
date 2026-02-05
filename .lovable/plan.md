

# 資金概況橫條固定顯示計畫

## 需求說明

使用者希望「資金概況橫條」的數值不隨年/月/週切換而變化，而是固定顯示策略的整體累積績效。這樣可以避免誤解，讓使用者隨時都能看到「如果投入 100 萬，目前總體資產是多少」。

---

## 設計目標

| 欄位 | 現況 | 修改後 |
|------|------|--------|
| 起始資金 | $1,000,000（固定） | $1,000,000（固定）- 不變 |
| 目前資產 | 根據年/月/週累積計算 | 使用 `sinceInceptionReturnPct` 固定計算 |
| 總報酬率 | 根據年/月/週累積計算 | 使用 `sinceInceptionReturnPct` 固定顯示 |

---

## 資料來源

策略系統中已有固定的「自成立以來累積報酬率」：

```typescript
// src/data/strategyMockData.ts
performanceSummary: {
  sinceInceptionReturnPct: 68.5,  // ← 這是固定的總報酬率
  // ...
}
```

---

## 檔案變更

### 修改 `src/components/strategy/PerformanceOverviewPanel.tsx`

#### 1. 新增 import

```tsx
import { 
  getPerformanceByPeriod, 
  getStrategySystemByExpertSlug,  // 新增
  PeriodPerformance, 
  StockTradeDetail 
} from "@/data/strategyMockData";
```

#### 2. 取得策略系統資料

```tsx
// 取得策略系統（用於固定顯示的總報酬率）
const strategySystem = useMemo(() => {
  return getStrategySystemByExpertSlug(expertSlug);
}, [expertSlug]);

// 使用 Since Inception 報酬率（固定值，不受維度切換影響）
const sinceInceptionReturn = strategySystem?.performanceSummary.sinceInceptionReturnPct ?? 0;
```

#### 3. 修改資產計算邏輯

```tsx
// 計算目前資產（使用固定的 SI 報酬率）
const currentAsset = useMemo(() => {
  return Math.round(INITIAL_CAPITAL * (1 + sinceInceptionReturn / 100));
}, [sinceInceptionReturn]);
```

#### 4. 修改 Capital Snapshot Bar 顯示

```tsx
{/* Capital Snapshot Bar */}
<div className="flex items-center justify-between px-4 py-3 bg-muted/40 dark:bg-white/[0.04] rounded-lg">
  {/* 起始資金 - 左側 */}
  <div className="text-center min-w-0">
    <p className="text-xs text-muted-foreground mb-0.5">起始資金</p>
    <p className="text-sm font-medium tabular-nums text-foreground">
      ${INITIAL_CAPITAL.toLocaleString()}
    </p>
  </div>
  
  {/* 目前資產 - 中間 */}
  <div className="text-center min-w-0">
    <p className="text-xs text-muted-foreground mb-0.5">目前資產</p>
    <p className="text-base font-semibold tabular-nums text-foreground">
      ${currentAsset.toLocaleString()}
    </p>
  </div>
  
  {/* 總報酬率 - 右側（使用固定的 sinceInceptionReturn） */}
  <div className="text-center min-w-0">
    <p className="text-xs text-muted-foreground mb-0.5">總報酬率</p>
    <p className={cn(
      "text-lg font-bold tabular-nums",
      sinceInceptionReturn >= 0 ? "text-success" : "text-destructive"
    )}>
      {sinceInceptionReturn >= 0 ? "+" : ""}{sinceInceptionReturn.toFixed(2)}%
    </p>
  </div>
</div>
```

#### 5. 移除不再需要的 `cumulativeReturn` 計算

原本根據 `performanceData` 計算的 `cumulativeReturn` 可以刪除，因為已改用固定的 `sinceInceptionReturn`。

---

## 行為變化對比

| 操作 | 現況 | 修改後 |
|------|------|--------|
| 切換年績效 | 橫條數值變化 | 橫條數值**不變** |
| 切換月績效 | 橫條數值變化 | 橫條數值**不變** |
| 切換週績效 | 橫條數值變化 | 橫條數值**不變** |
| 圖表顯示 | 對應維度資料 | 對應維度資料（不變） |
| 個股排名 | 對應維度資料 | 對應維度資料（不變） |

---

## 範例數值

以 `zhao-advisor` 為例：

- `sinceInceptionReturnPct`: 125.5%
- 起始資金：$1,000,000
- 目前資產：$2,255,000（$1,000,000 × 2.255）
- 總報酬率：+125.50%

無論切換到年績效、月績效或週績效，這三個數值都固定不變。

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/components/strategy/PerformanceOverviewPanel.tsx` | 修改 | 改用固定的 sinceInceptionReturnPct 計算資產與報酬率 |

