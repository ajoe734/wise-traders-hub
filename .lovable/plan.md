

# 資金概況橫條（Capital Snapshot Bar）實作計畫

## 需求分析

在 Segmented Control 與圖表之間新增一條「資金概況橫條」，讓會員一眼知道：「如果我一開始拿 100 萬跟單，現在會變多少錢」。

---

## 設計目標

```text
┌────────────────────────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┐                        │
│  │  年績效   │   月績效  │  週績效   │  ← Segmented Control  │
│  └──────────┴──────────┴──────────┘                        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  起始資金          目前資產              總報酬率      │  │
│  │  $1,000,000       $1,186,400            +18.64%      │  │ ← Capital Snapshot Bar
│  │  (小字灰色)       (中字)                (大字變色)     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│        ┌─ 最佳/最差個股 ─┐                                 │
│        └─────────────────┘                                 │
│                                                            │
│     ~~~~面積圖~~~~                                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 資料計算邏輯

### 總報酬率計算

根據 `performanceData`（年/月/週績效資料）計算累積報酬：

```typescript
// 計算該維度的累積報酬率
const cumulativeReturn = useMemo(() => {
  if (!performanceData.length) return 0;
  // 複利計算：(1 + r1) * (1 + r2) * ... - 1
  const totalReturn = performanceData.reduce((acc, p) => {
    return acc * (1 + p.returnPct / 100);
  }, 1);
  return (totalReturn - 1) * 100;
}, [performanceData]);
```

### 目前資產計算

```typescript
const INITIAL_CAPITAL = 1000000; // 固定起始資金 100 萬

const currentAsset = useMemo(() => {
  return Math.round(INITIAL_CAPITAL * (1 + cumulativeReturn / 100));
}, [cumulativeReturn]);
```

---

## 檔案變更

### 修改 `src/components/strategy/PerformanceOverviewPanel.tsx`

#### 1. 新增常數與計算邏輯

```tsx
// 起始資金（固定值）
const INITIAL_CAPITAL = 1000000;

// 計算該維度的累積報酬率
const cumulativeReturn = useMemo(() => {
  if (!performanceData.length) return 0;
  // 複利計算
  const totalReturn = performanceData.reduce((acc, p) => {
    return acc * (1 + p.returnPct / 100);
  }, 1);
  return (totalReturn - 1) * 100;
}, [performanceData]);

// 計算目前資產
const currentAsset = useMemo(() => {
  return Math.round(INITIAL_CAPITAL * (1 + cumulativeReturn / 100));
}, [cumulativeReturn]);
```

#### 2. 新增 Capital Snapshot Bar 元件（內嵌）

在 Segmented Control 下方、Chart Area 上方插入：

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
  
  {/* 總報酬率 - 右側 */}
  <div className="text-center min-w-0">
    <p className="text-xs text-muted-foreground mb-0.5">總報酬率</p>
    <p className={cn(
      "text-lg font-bold tabular-nums",
      cumulativeReturn >= 0 ? "text-success" : "text-destructive"
    )}>
      {cumulativeReturn >= 0 ? "+" : ""}{cumulativeReturn.toFixed(2)}%
    </p>
  </div>
</div>
```

---

## 視覺規格

| 項目 | 樣式 |
|------|------|
| **容器** | `bg-muted/40 dark:bg-white/[0.04] rounded-lg px-4 py-3` |
| **起始資金** | 標籤 `text-xs text-muted-foreground`，數值 `text-sm font-medium` |
| **目前資產** | 標籤同上，數值 `text-base font-semibold` |
| **總報酬率** | 標籤同上，數值 `text-lg font-bold`，正值 `text-success`，負值 `text-destructive` |
| **數字** | 全部使用 `tabular-nums` 確保等寬對齊 |

---

## 行為規格

| 操作 | 行為 |
|------|------|
| **切換年/月/週** | 數值立即更新（無動畫），反映該維度的累積報酬 |
| **顏色變化** | 總報酬率正值顯示紅色（success），負值顯示綠色（destructive） |
| **響應式** | 三欄等分，小螢幕時文字自動收縮 |

---

## 完整佈局順序

1. Segmented Control（年/月/週切換）
2. **Capital Snapshot Bar**（新增）
3. Chart Area（含 FloatingStatCard + AreaChart）
4. 點擊提示 / 個股排名收合區塊

---

## 技術細節

### 複利計算說明

使用複利方式計算累積報酬，而非簡單相加：

```
年報酬範例：2022 +12.5%, 2023 +25.8%, 2024 +32.4%, 2025 +8.2%
累積報酬 = (1.125 × 1.258 × 1.324 × 1.082) - 1 = 101.5%
```

這樣更貼近實際投資情境，也能對應「如果跟單，現在會變多少錢」的直覺問題。

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/components/strategy/PerformanceOverviewPanel.tsx` | 修改 | 新增資金概況計算邏輯與橫條 UI |

