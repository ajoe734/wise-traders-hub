

# 績效總覽面板（Performance Overview Panel）設計計畫

## 設計理念

採用「分層揭露資訊」設計原則：

- **第一層**：Segmented Control + 單一圖表 + 浮動資訊卡
- **第二層**：Hover/點擊時展開個股排名
- **核心目標**：讓會員第一眼看到趨勢，需要時再看細節

---

## 視覺架構圖

```text
┌─────────────────────────────────────────────────────────┐
│  ┌─────────┬─────────┬─────────┐                        │
│  │  年績效  │  月績效  │  週績效  │  ← Segmented Control  │
│  └─────────┴─────────┴─────────┘                        │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                                    ┌────────────┐ │  │
│  │                                    │ 🏆 最佳     │ │  │
│  │     ~~~~~/\~~~~/\~~~~              │ 創意 +12%  │ │  │
│  │  ~~~~/         \~~~~               │            │ │  │
│  │ ~/               \~~~~             │ 📉 最差     │ │  │
│  │                                    │ 台塑 -3%   │ │  │
│  │     [  Area Chart  ]               └────────────┘ │  │
│  │                                                   │  │
│  │   ───────●────────────────────                    │  │
│  │          ↑                                        │  │
│  │      點擊節點                                      │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  ▼ 2024年11月 個股排名                  收合/展開   │  │
│  │  ┌─────────────────┬─────────────────┐            │  │
│  │  │ TOP 5           │ BOTTOM 5        │            │  │
│  │  │ 1. 創意 +12.5%  │ 1. 台塑 -3.5%   │            │  │
│  │  │ 2. 聯發科 +8.2% │ 2. 國巨 -2.8%   │            │  │
│  │  │ 3. 台積電 +6.1% │ ...             │            │  │
│  │  └─────────────────┴─────────────────┘            │  │
│  └───────────────────────────────────────────────────┘  │
│         ↑                                               │
│     預設收合，點擊節點後展開                              │
└─────────────────────────────────────────────────────────┘
```

---

## 檔案變更

### 1. 新增元件：`src/components/strategy/PerformanceOverviewPanel.tsx`

主要元件，包含：

```tsx
// 資料維度定義
type ViewPeriod = 'yearly' | 'monthly' | 'weekly';

// Mock 資料結構 - 每個時間點的績效快照
interface PeriodPerformance {
  label: string;        // "2024", "2024-11", "W48"
  date: string;         // 用於排序
  returnPct: number;    // 報酬率
  topStock?: StockPerf; // 最佳個股
  bottomStock?: StockPerf; // 最差個股
  stocks?: StockPerf[]; // 完整個股列表（用於展開）
}

interface StockPerf {
  symbol: string;
  name: string;
  returnPct: number;
}
```

**元件結構：**

```tsx
export function PerformanceOverviewPanel({ expertSlug }: Props) {
  const [period, setPeriod] = useState<ViewPeriod>('monthly');
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card>
      {/* 1. Segmented Control */}
      <Tabs value={period} onValueChange={setPeriod}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="yearly">年績效</TabsTrigger>
          <TabsTrigger value="monthly">月績效</TabsTrigger>
          <TabsTrigger value="weekly">週績效</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 2. 圖表區 + 浮動資訊卡 */}
      <div className="relative">
        <AreaChart 
          data={chartData}
          onPointClick={handlePointClick}
          animationDuration={500}
        />
        
        {/* 浮動資訊卡 - 絕對定位於右上角 */}
        <div className="absolute top-2 right-2 w-32">
          <FloatingStatCard 
            bestStock={currentData.topStock}
            worstStock={currentData.bottomStock}
          />
        </div>
      </div>

      {/* 3. 可收合的個股排名 */}
      <Collapsible open={isExpanded && !!selectedPoint}>
        <CollapsibleTrigger>
          {selectedPoint ? `${selectedLabel} 個股排名` : '點擊圖表查看個股'}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 gap-4">
            {/* Top 5 */}
            <div>
              <h4>表現最佳</h4>
              {top5Stocks.map(...)}
            </div>
            {/* Bottom 5 */}
            <div>
              <h4>表現最差</h4>
              {bottom5Stocks.map(...)}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
```

---

### 2. 新增子元件：`src/components/strategy/FloatingStatCard.tsx`

小型浮動卡片顯示最佳/最差個股：

```tsx
interface FloatingStatCardProps {
  bestStock?: StockPerf;
  worstStock?: StockPerf;
}

export function FloatingStatCard({ bestStock, worstStock }: Props) {
  return (
    <div className="bg-background/80 backdrop-blur-sm border rounded-lg p-2 shadow-lg space-y-2">
      {/* 最佳 */}
      <div className="text-xs">
        <div className="text-muted-foreground flex items-center gap-1">
          <Trophy className="h-3 w-3 text-amber-500" />
          本期最佳
        </div>
        <div className="font-medium">
          {bestStock?.name}
          <span className="text-success ml-1">+{bestStock?.returnPct}%</span>
        </div>
      </div>
      
      {/* 最差 */}
      <div className="text-xs">
        <div className="text-muted-foreground flex items-center gap-1">
          <TrendingDown className="h-3 w-3 text-destructive" />
          本期最差
        </div>
        <div className="font-medium">
          {worstStock?.name}
          <span className="text-destructive ml-1">{worstStock?.returnPct}%</span>
        </div>
      </div>
    </div>
  );
}
```

---

### 3. 更新：`src/pages/app/ExpertDetail.tsx`

替換現有的「績效摘要」2x2 格狀卡片為新的 Panel：

```tsx
// 移除
<div className="grid grid-cols-2 gap-3">
  <Card>累積報酬...</Card>
  ...
</div>

// 新增
import { PerformanceOverviewPanel } from '@/components/strategy/PerformanceOverviewPanel';

<PerformanceOverviewPanel 
  expertSlug={slug} 
/>
```

---

### 4. 更新：`src/data/strategyMockData.ts`

新增 Mock 資料生成函數：

```tsx
// 生成年度績效數據
function generateYearlyPerformance(system: StrategySystem): PeriodPerformance[] {
  // 基於 equityHistory 生成年度彙總
}

// 生成月度績效數據  
function generateMonthlyPerformance(system: StrategySystem): PeriodPerformance[] {
  // 基於 equityHistory 生成月度彙總，包含該月最佳/最差個股
}

// 生成週度績效數據
function generateWeeklyPerformance(system: StrategySystem): PeriodPerformance[] {
  // 基於 equityHistory 生成週度彙總
}

// Helper 導出
export function getPerformanceByPeriod(
  expertSlug: string, 
  period: 'yearly' | 'monthly' | 'weekly'
): PeriodPerformance[]
```

---

## 互動行為

| 操作 | 結果 |
|------|------|
| 切換 Segmented Control | 圖表數據平滑過渡（500ms），浮動卡顯示該維度的最佳/最差 |
| Hover 圖表節點 | 顯示 Tooltip（日期 + 報酬率） |
| 點擊圖表節點 | 下方展開該時間點的 Top/Bottom 5 個股排名 |
| 再次點擊同節點 | 收合個股排名 |
| 點擊其他節點 | 切換至新節點的個股排名 |

---

## 動畫效果

```tsx
// 1. 圖表切換動畫 - 使用 recharts 內建
<AreaChart animationDuration={500} />

// 2. 收合/展開動畫 - 使用 Radix Collapsible
<CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">

// 3. 浮動卡片淡入效果
<FloatingStatCard className="animate-fade-in" />
```

---

## 深色模式支援

所有元件將沿用已建立的深色模式 pattern：

- 浮動卡片：`bg-background/80 dark:bg-white/10 backdrop-blur-sm dark:border-white/10`
- 收合區塊：`dark:bg-white/[0.03] dark:border-white/10`
- 成功/失敗文字：`text-success` / `text-destructive`（已有深色支援）

---

## 技術細節

| 技術 | 說明 |
|------|------|
| Recharts | AreaChart + 自訂 Tooltip + 點擊事件 |
| Radix Tabs | Segmented Control 切換器 |
| Radix Collapsible | 個股排名的收合/展開 |
| CSS 動畫 | accordion-up/down + fade-in |
| useState | period、selectedPoint、isExpanded |

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/components/strategy/PerformanceOverviewPanel.tsx` | 新增 | 主要面板元件 |
| `src/components/strategy/FloatingStatCard.tsx` | 新增 | 浮動資訊卡元件 |
| `src/pages/app/ExpertDetail.tsx` | 修改 | 替換績效摘要區塊 |
| `src/data/strategyMockData.ts` | 修改 | 新增維度績效 Mock 資料生成 |

