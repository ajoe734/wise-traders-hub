

# 績效儀表板優化計畫

## 現況分析

目前 `PerformanceOverviewPanel` 已實現基本功能，但仍有以下可優化之處：

1. **Segmented Control** - 選取狀態視覺指示不夠明顯
2. **圖表色彩** - 無論正負值皆使用固定 primary 色
3. **間距與邊距** - 圖表稍嵌貼邊，資訊卡覆蓋曲線範圍
4. **收合區塊** - 觸發器一直顯示，不夠精簡
5. **頁面間距** - 專家介紹與績效區塊間距可再優化

---

## 設計目標

```text
┌────────────────────────────────────────────────────────────┐
│  ┌──────────┬──────────┬──────────┐                        │
│  │  年績效   │   月績效  │  週績效   │  ← 明確選取狀態       │
│  └──────────┴──────────┴──────────┘    (底線 + 色彩變化)    │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │   ┌──────────┐                                       │  │
│  │   │ 最佳/最差 │  ← 固定右上角外側，不覆蓋曲線          │  │
│  │   └──────────┘                                       │  │
│  │                                                      │  │
│  │     ~~~~暖色~/\~~~~/\~~~~   ← 正值：暖色系            │  │
│  │  ~~冷色~~~/         \~~~~   ← 負值：冷色系            │  │
│  │ ~/               \~~~~                               │  │
│  │                                                      │  │
│  │         適度邊距 (padding 增加)                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  點擊圖表節點查看個股排名 ← 提示文字（點擊前顯示）           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ▼ 2024年11月 個股排名                                 │  │ ← 點擊後展開
│  │ ┌────────────────┬─────────────────┐                 │  │
│  │ │ TOP 5          │ BOTTOM 5        │                 │  │
│  │ └────────────────┴─────────────────┘                 │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 檔案變更

### 1. 修改 `src/components/strategy/PerformanceOverviewPanel.tsx`

#### 1.1 Segmented Control 優化

強化選取狀態視覺指示，加入底線效果：

```tsx
<TabsList className="grid w-full grid-cols-3 bg-muted/30 dark:bg-white/[0.02] p-1 h-11">
  <TabsTrigger 
    value="yearly" 
    className="text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary font-medium"
  >
    年績效
  </TabsTrigger>
  {/* monthly, weekly 同樣處理 */}
</TabsList>
```

**變化：**
- `bg-muted/30` 降低背景對比，讓選取狀態更明顯
- 加入 `data-[state=active]:border-b-2 data-[state=active]:border-primary`
- 選取時文字變為 `text-primary`
- 高度增加至 `h-11` 提升觸控友善度

#### 1.2 圖表顏色根據正負值變化

新增動態漸層定義，根據資料整體走勢調整色調：

```tsx
// 計算整體收益傾向
const overallTrend = useMemo(() => {
  if (!performanceData.length) return 'neutral';
  const avgReturn = performanceData.reduce((sum, p) => sum + p.returnPct, 0) / performanceData.length;
  return avgReturn >= 0 ? 'positive' : 'negative';
}, [performanceData]);

// 色彩定義
const chartColors = useMemo(() => {
  if (overallTrend === 'positive') {
    return {
      stroke: 'hsl(4 82% 56%)',         // 紅色暖系（台股上漲色）
      gradientStart: 'hsl(4 82% 56%)',
      gradientEnd: 'hsl(4 82% 56%)',
    };
  } else {
    return {
      stroke: 'hsl(142 76% 46%)',       // 綠色冷系（台股下跌色）
      gradientStart: 'hsl(142 76% 46%)',
      gradientEnd: 'hsl(142 76% 46%)',
    };
  }
}, [overallTrend]);
```

圖表渲染時使用動態 ID 避免漸層衝突：

```tsx
<defs>
  <linearGradient id={`colorReturn-${period}`} x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%" stopColor={chartColors.gradientStart} stopOpacity={0.25} />
    <stop offset="95%" stopColor={chartColors.gradientEnd} stopOpacity={0} />
  </linearGradient>
</defs>
<Area
  stroke={chartColors.stroke}
  fill={`url(#colorReturn-${period})`}
  // ...
/>
```

#### 1.3 圖表邊距與資訊卡位置優化

增加圖表容器內邊距，將資訊卡移至圖表外側：

```tsx
{/* 主圖表容器 - 增加 padding */}
<div className="relative pt-2 pb-4 px-2">
  {/* 圖表區域 */}
  <div className="h-52">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={chartData}
        margin={{ top: 16, right: 16, left: 8, bottom: 8 }}
        // ...
      >
```

資訊卡改為固定於右上角外側，不覆蓋曲線：

```tsx
{/* 浮動資訊卡 - 移至圖表容器上方右側 */}
<div className="flex justify-end mb-2">
  <FloatingStatCard 
    bestStock={periodStats.best}
    worstStock={periodStats.worst}
    className="w-auto"
  />
</div>
```

#### 1.4 收合區塊互動優化

預設完全隱藏 trigger，僅在選取節點後顯示：

```tsx
{/* 只有選取節點後才顯示收合區塊 */}
{selectedPoint && (
  <Collapsible 
    open={isExpanded}
    onOpenChange={setIsExpanded}
  >
    <CollapsibleTrigger 
      className="flex items-center justify-between w-full py-2.5 px-4 rounded-lg 
                 bg-muted/40 dark:bg-white/[0.04] 
                 border border-transparent dark:border-white/10 
                 text-sm hover:bg-muted/60 dark:hover:bg-white/[0.08] 
                 transition-colors"
    >
      <span className="font-medium text-foreground">
        {selectedPoint} 個股排名
      </span>
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground transition-transform duration-200",
        isExpanded && "rotate-180"
      )} />
    </CollapsibleTrigger>
    
    <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
      {/* Top/Bottom 5 內容 */}
    </CollapsibleContent>
  </Collapsible>
)}

{/* 未選取時顯示提示 */}
{!selectedPoint && (
  <p className="text-xs text-muted-foreground dark:text-white/50 text-center py-3">
    點擊圖表節點查看個股排名
  </p>
)}
```

#### 1.5 個股排名卡片樣式優化

以卡片形式呈現，保持簡潔：

```tsx
<CollapsibleContent className="pt-3">
  <div className="grid grid-cols-2 gap-4">
    {/* Top 5 */}
    <div className="bg-success/5 dark:bg-success/10 rounded-lg p-3 space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-success" />
        表現最佳
      </h4>
      <div className="space-y-1.5">
        {top5.map((stock, idx) => (
          <div 
            key={stock.symbol}
            className="flex items-center justify-between text-xs py-1"
          >
            <span className="text-foreground">
              <span className="text-muted-foreground/70 mr-1.5 tabular-nums">{idx + 1}.</span>
              {stock.name}
            </span>
            <span className="text-success font-medium tabular-nums">
              +{stock.returnPct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>

    {/* Bottom 5 - 同樣處理 */}
  </div>
</CollapsibleContent>
```

---

### 2. 修改 `src/components/strategy/FloatingStatCard.tsx`

優化外觀，使其更簡潔並適應 inline 佈局：

```tsx
export function FloatingStatCard({ bestStock, worstStock, className }: FloatingStatCardProps) {
  if (!bestStock && !worstStock) return null;

  return (
    <div 
      className={cn(
        "inline-flex items-center gap-4 bg-muted/50 dark:bg-white/[0.05]",
        "backdrop-blur-sm rounded-lg px-3 py-2",
        "border border-border/50 dark:border-white/10",
        "animate-fade-in",
        className
      )}
    >
      {/* 最佳個股 */}
      {bestStock && (
        <div className="flex items-center gap-2 text-xs">
          <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-muted-foreground">最佳</span>
          <span className="font-medium text-foreground">{bestStock.name}</span>
          <span className="text-success font-semibold tabular-nums">
            +{bestStock.returnPct.toFixed(1)}%
          </span>
        </div>
      )}
      
      {/* 分隔線 */}
      {bestStock && worstStock && (
        <div className="w-px h-4 bg-border dark:bg-white/20" />
      )}
      
      {/* 最差個股 */}
      {worstStock && (
        <div className="flex items-center gap-2 text-xs">
          <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />
          <span className="text-muted-foreground">最差</span>
          <span className="font-medium text-foreground">{worstStock.name}</span>
          <span className="text-destructive font-semibold tabular-nums">
            {worstStock.returnPct.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
```

---

### 3. 修改 `src/pages/app/ExpertDetail.tsx`

增加專家介紹區與績效區塊之間的間距：

```tsx
{/* Expert Header */}
<div className="flex items-start gap-4">
  {/* ... */}
</div>

{/* 增加間距 */}
<div className="h-2" />

{/* Subscription Status */}
{isSubscribed && (
  <Card className="border-primary/30 bg-primary/5">
    {/* ... */}
  </Card>
)}

{/* 績效區塊標題優化 */}
<div className="pt-2">
  <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
    <TrendingUp className="h-4 w-4" />
    <span>績效總覽</span>
  </h2>
  <PerformanceOverviewPanel expertSlug={slug || ""} />
</div>
```

**變化：**
- 標題改為 `text-base`（較小字體）
- 文字色彩改為 `text-muted-foreground`（灰階）
- 整體區塊加入 `pt-2` 頂部間距

---

## 互動邏輯總結

| 狀態 | 顯示內容 |
|------|----------|
| **初始** | Segmented Control + 圖表 + 資訊卡 + 提示文字 |
| **點擊節點** | 展開收合區塊顯示 Top/Bottom 5 |
| **切換維度** | 圖表平滑過渡 + 資訊卡更新 + 重置選取狀態 |
| **再次點擊** | 收合個股排名 |

---

## 視覺優化對照表

| 項目 | 現況 | 優化後 |
|------|------|--------|
| Segmented Control | 基本樣式 | 加入底線 + primary 色彩標示 |
| 圖表顏色 | 固定 primary | 正值暖色、負值冷色 |
| 圖表邊距 | `margin: 10/100/-10/0` | `margin: 16/16/8/8` + 容器 padding |
| 資訊卡位置 | 絕對定位覆蓋曲線 | 圖表上方水平排列 |
| 收合觸發器 | 一直顯示 | 選取節點後才出現 |
| 個股卡片 | 基本列表 | 圓角卡片 + 背景色區分 |
| 區塊間距 | 預設 `space-y-6` | 標題灰階 + 頂部加距 |

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/components/strategy/PerformanceOverviewPanel.tsx` | 修改 | Segmented Control、圖表色彩、邊距、收合區塊優化 |
| `src/components/strategy/FloatingStatCard.tsx` | 修改 | 改為 inline 水平排列，簡化外觀 |
| `src/pages/app/ExpertDetail.tsx` | 修改 | 標題樣式調整、區塊間距優化 |

