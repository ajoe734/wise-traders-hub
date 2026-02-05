
# 個股交易細節側滑面板（Stock Trade Detail Slide-over）設計計畫

## 需求分析

使用者點擊 Top/Bottom 5 個股排名中的任一股票時，應從右側滑入一個完整的交易細節卡片，而非在原地展開文字。

---

## 設計目標

```text
┌─────────────────────────────────────────────────────────────────┐
│ 主畫面（不被撐開）                              │ Slide-over Panel │
│                                                 │ ┌──────────────┐ │
│  ┌─────────────────────────────────────────┐    │ │ 台積電 2330  │ │
│  │ ▼ 2024/11 個股排名                      │    │ │              │ │
│  │ ┌────────────┬────────────┐             │    │ │ 建倉時間     │ │
│  │ │ TOP 5      │ BOTTOM 5   │             │    │ │ 2024/10/15   │ │
│  │ │            │            │             │    │ │              │ │
│  │ │ 台積電 ←── │            │  點擊觸發 ──┼────│ │ 持有天數     │ │
│  │ │ 聯發科     │ 台塑       │             │    │ │ 45 天        │ │
│  │ │ ...        │ ...        │             │    │ │              │ │
│  │ └────────────┴────────────┘             │    │ │ 進場價格     │ │
│  └─────────────────────────────────────────┘    │ │ $580         │ │
│                                                 │ │              │ │
│                                                 │ │ 目前價格     │ │
│  ┌──────────────────────────────────────────┐   │ │ $615         │ │
│  │ 背景：點擊可關閉（半透明遮罩）            │   │ │              │ │
│  └──────────────────────────────────────────┘   │ │ 報酬率       │ │
│                                                 │ │ +6.03%       │ │
│                                                 │ │              │ │
│                                                 │ │ 績效貢獻說明 │ │
│                                                 │ │ 本月最大獲利 │ │
│                                                 │ │ 來源...      │ │
│                                                 │ └──────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 資料模型擴展

### 擴展 `StockPerf` 介面

現有的 `StockPerf` 只包含 `symbol`、`name`、`returnPct`，需擴展以支援交易細節：

```tsx
// 在 src/data/strategyMockData.ts 中擴展
export interface StockTradeDetail extends StockPerf {
  // 基礎資訊
  symbol: string;
  name: string;
  returnPct: number;
  
  // 交易細節
  entryDate: string;           // 建倉時間
  entryPrice: number;          // 進場價格
  currentPrice: number;        // 目前價格
  holdingDays: number;         // 持有天數（自動計算）
  quantity?: number;           // 持有股數
  marketValue?: number;        // 市值
  pnlAmt?: number;             // 損益金額
  
  // 績效貢獻說明
  contributionNote: string;    // 例如：「本月最大獲利來源」「拖累本週績效主因」
}
```

---

## 檔案變更

### 1. 新增元件：`src/components/strategy/StockTradeDetailSheet.tsx`

使用現有的 `Sheet` 元件實現右側滑入面板：

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar, Clock, TrendingUp, TrendingDown, DollarSign, BarChart3 } from "lucide-react";
import { StockTradeDetail } from "@/data/strategyMockData";
import { cn } from "@/lib/utils";

interface StockTradeDetailSheetProps {
  stock: StockTradeDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodLabel?: string;  // 顯示所屬時間區間，例如 "2024/11"
}

export function StockTradeDetailSheet({
  stock,
  open,
  onOpenChange,
  periodLabel,
}: StockTradeDetailSheetProps) {
  if (!stock) return null;

  const isPositive = stock.returnPct >= 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:w-[380px] overflow-y-auto">
        <SheetHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-xl">{stock.name}</SheetTitle>
            <Badge variant="outline" className="font-mono text-xs">
              {stock.symbol}
            </Badge>
          </div>
          {periodLabel && (
            <SheetDescription>
              {periodLabel} 績效表現
            </SheetDescription>
          )}
        </SheetHeader>

        <Separator />

        {/* 報酬率 Highlight */}
        <div className={cn(
          "my-6 p-4 rounded-lg text-center",
          isPositive 
            ? "bg-success/10 dark:bg-success/20" 
            : "bg-destructive/10 dark:bg-destructive/20"
        )}>
          <p className="text-sm text-muted-foreground mb-1">本期報酬率</p>
          <p className={cn(
            "text-3xl font-bold tabular-nums",
            isPositive ? "text-success" : "text-destructive"
          )}>
            {isPositive ? "+" : ""}{stock.returnPct.toFixed(2)}%
          </p>
        </div>

        {/* 交易細節列表 */}
        <div className="space-y-4">
          {/* 建倉時間 */}
          <DetailRow
            icon={<Calendar className="h-4 w-4" />}
            label="建倉時間"
            value={formatDate(stock.entryDate)}
          />

          {/* 持有天數 */}
          <DetailRow
            icon={<Clock className="h-4 w-4" />}
            label="持有天數"
            value={`${stock.holdingDays} 天`}
          />

          <Separator />

          {/* 進場價格 */}
          <DetailRow
            icon={<DollarSign className="h-4 w-4" />}
            label="進場價格"
            value={`$${stock.entryPrice.toLocaleString()}`}
          />

          {/* 目前價格 */}
          <DetailRow
            icon={isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            label="目前價格"
            value={`$${stock.currentPrice.toLocaleString()}`}
            valueClassName={isPositive ? "text-success" : "text-destructive"}
          />

          {/* 損益金額（可選） */}
          {stock.pnlAmt !== undefined && (
            <DetailRow
              icon={<BarChart3 className="h-4 w-4" />}
              label="損益金額"
              value={`${stock.pnlAmt >= 0 ? "+" : ""}$${stock.pnlAmt.toLocaleString()}`}
              valueClassName={stock.pnlAmt >= 0 ? "text-success" : "text-destructive"}
            />
          )}
        </div>

        <Separator className="my-6" />

        {/* 績效貢獻說明 */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            績效貢獻說明
          </h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {stock.contributionNote}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// 輔助元件：細節列
function DetailRow({ 
  icon, 
  label, 
  value, 
  valueClassName 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className={cn("font-medium tabular-nums", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

// 日期格式化
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}
```

---

### 2. 修改 `src/data/strategyMockData.ts`

#### 2.1 新增 `StockTradeDetail` 介面

```tsx
export interface StockTradeDetail {
  symbol: string;
  name: string;
  returnPct: number;
  entryDate: string;
  entryPrice: number;
  currentPrice: number;
  holdingDays: number;
  quantity?: number;
  marketValue?: number;
  pnlAmt?: number;
  contributionNote: string;
}
```

#### 2.2 修改 `PeriodPerformance.stocks` 類型

```tsx
export interface PeriodPerformance {
  label: string;
  date: string;
  returnPct: number;
  topStock?: StockPerf;
  bottomStock?: StockPerf;
  stocks?: StockTradeDetail[];  // 改為使用擴展版本
}
```

#### 2.3 修改 `generateRandomStocks` 函數

生成包含交易細節的 Mock 資料：

```tsx
function generateRandomStocks(baseReturn: number, periodDate: string): StockTradeDetail[] {
  return stockPool.map((stock, idx) => {
    const returnPct = Math.round((baseReturn + (Math.random() - 0.5) * 20) * 10) / 10;
    const entryPrice = Math.round((100 + Math.random() * 500) * 10) / 10;
    const currentPrice = Math.round(entryPrice * (1 + returnPct / 100) * 10) / 10;
    const holdingDays = Math.floor(Math.random() * 60) + 5;
    
    // 動態生成貢獻說明
    let contributionNote: string;
    if (returnPct > 10) {
      contributionNote = `本期獲利主力，貢獻整體績效約 ${Math.abs(returnPct * 0.15).toFixed(1)}%。股價突破關鍵壓力區後持續走高，外資持續買超支撐。`;
    } else if (returnPct > 0) {
      contributionNote = `穩定貢獻正報酬，符合策略預期。維持原有部位配置，持續觀察趨勢變化。`;
    } else if (returnPct > -5) {
      contributionNote = `小幅回檔整理中，尚在停損線之上。密切關注支撐位守住情況。`;
    } else {
      contributionNote = `本期拖累績效主因，已觸及停損條件。檢討進場時機與部位控管，作為後續教學案例。`;
    }
    
    return {
      ...stock,
      returnPct,
      entryDate: generateEntryDate(periodDate, holdingDays),
      entryPrice,
      currentPrice,
      holdingDays,
      quantity: Math.floor(Math.random() * 5 + 1) * 1000,
      pnlAmt: Math.round((currentPrice - entryPrice) * (Math.floor(Math.random() * 5 + 1) * 1000)),
      contributionNote,
    };
  }).sort((a, b) => b.returnPct - a.returnPct);
}

function generateEntryDate(periodDate: string, holdingDays: number): string {
  const endDate = new Date(periodDate);
  const entryDate = new Date(endDate);
  entryDate.setDate(endDate.getDate() - holdingDays);
  return entryDate.toISOString().split('T')[0];
}
```

---

### 3. 修改 `src/components/strategy/PerformanceOverviewPanel.tsx`

整合 Slide-over 互動：

#### 3.1 新增 State

```tsx
import { StockTradeDetailSheet } from "./StockTradeDetailSheet";
import { StockTradeDetail } from "@/data/strategyMockData";

// 新增 state
const [selectedStock, setSelectedStock] = useState<StockTradeDetail | null>(null);
const [isSheetOpen, setIsSheetOpen] = useState(false);

// 處理個股點擊
const handleStockClick = (stock: StockTradeDetail) => {
  setSelectedStock(stock);
  setIsSheetOpen(true);
};
```

#### 3.2 修改個股列表渲染

將 Top/Bottom 5 個股改為可點擊：

```tsx
{/* Top 5 */}
<div className="bg-success/5 dark:bg-success/10 rounded-lg p-3 space-y-2">
  <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
    <TrendingUp className="h-3.5 w-3.5 text-success" />
    表現最佳
  </h4>
  <div className="space-y-1">
    {top5.map((stock, idx) => (
      <button
        key={stock.symbol}
        onClick={() => handleStockClick(stock as StockTradeDetail)}
        className="flex items-center justify-between w-full text-xs py-1.5 px-1 -mx-1 rounded hover:bg-success/10 dark:hover:bg-success/20 transition-colors cursor-pointer text-left"
      >
        <span className="text-foreground">
          <span className="text-muted-foreground/70 mr-1.5 tabular-nums">{idx + 1}.</span>
          {stock.name}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-success font-medium tabular-nums">
            +{stock.returnPct.toFixed(1)}%
          </span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
        </div>
      </button>
    ))}
  </div>
</div>
```

#### 3.3 新增 Sheet 元件

在元件最後加入 Sheet：

```tsx
return (
  <Card className="overflow-hidden">
    <CardContent className="p-4 space-y-4">
      {/* ... 現有內容 ... */}
    </CardContent>

    {/* Stock Trade Detail Sheet */}
    <StockTradeDetailSheet
      stock={selectedStock}
      open={isSheetOpen}
      onOpenChange={setIsSheetOpen}
      periodLabel={selectedPoint || undefined}
    />
  </Card>
);
```

---

## 動畫效果

Sheet 元件已內建平滑動畫：

```tsx
// 來自 sheet.tsx 的 sheetVariants
"data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
"data-[state=closed]:duration-300 data-[state=open]:duration-500"
```

背景遮罩淡入淡出：
```tsx
// SheetOverlay
"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
```

---

## 互動行為總結

| 操作 | 結果 |
|------|------|
| **點擊個股名稱** | 從右側滑入交易細節面板 |
| **點擊背景遮罩** | 關閉面板（Sheet 內建行為） |
| **點擊右上角 X** | 關閉面板 |
| **滑動手勢（行動裝置）** | Sheet 內建支援 |
| **切換時間維度** | 自動關閉 Sheet，清空選取 |

---

## 視覺設計規範

| 項目 | 規格 |
|------|------|
| **面板寬度** | 320px（行動）/ 380px（桌面） |
| **報酬率區塊** | 置中、大字體、背景色區分正負 |
| **細節列表** | icon + label 左對齊，value 右對齊 |
| **績效說明** | 獨立區塊，bullet point 標示 |
| **動畫時長** | 開啟 500ms / 關閉 300ms |

---

## 深色模式支援

沿用現有設計系統：

- 面板背景：`bg-background`（自動適應）
- 成功色：`text-success` / `bg-success/10 dark:bg-success/20`
- 失敗色：`text-destructive` / `bg-destructive/10 dark:bg-destructive/20`
- 邊框：`border dark:border-white/10`

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/components/strategy/StockTradeDetailSheet.tsx` | 新增 | 右側滑入交易細節面板 |
| `src/data/strategyMockData.ts` | 修改 | 新增 `StockTradeDetail` 介面與生成函數 |
| `src/components/strategy/PerformanceOverviewPanel.tsx` | 修改 | 整合 Sheet 互動，個股改為可點擊 |
