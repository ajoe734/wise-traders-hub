import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
 import { ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { FloatingStatCard, StockPerf } from "./FloatingStatCard";
 import { getPerformanceByPeriod, PeriodPerformance, StockTradeDetail } from "@/data/strategyMockData";
 import { StockTradeDetailSheet } from "./StockTradeDetailSheet";
import { cn } from "@/lib/utils";

type ViewPeriod = "yearly" | "monthly" | "weekly";

interface PerformanceOverviewPanelProps {
  expertSlug: string;
}

export function PerformanceOverviewPanel({ expertSlug }: PerformanceOverviewPanelProps) {
  const [period, setPeriod] = useState<ViewPeriod>("monthly");
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
   const [selectedStock, setSelectedStock] = useState<StockTradeDetail | null>(null);
   const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Get performance data based on period
  const performanceData = useMemo(() => {
    return getPerformanceByPeriod(expertSlug, period);
  }, [expertSlug, period]);

  // Calculate overall trend for dynamic chart color
  const overallTrend = useMemo(() => {
    if (!performanceData.length) return 'neutral';
    const avgReturn = performanceData.reduce((sum, p) => sum + p.returnPct, 0) / performanceData.length;
    return avgReturn >= 0 ? 'positive' : 'negative';
  }, [performanceData]);

  // Dynamic chart colors based on trend (Taiwan stock market: red=up, green=down)
  const chartColors = useMemo(() => {
    if (overallTrend === 'positive') {
      return {
        stroke: 'hsl(4 82% 56%)',         // Warm red for positive
        gradientStart: 'hsl(4 82% 56%)',
        gradientEnd: 'hsl(4 82% 56%)',
      };
    } else {
      return {
        stroke: 'hsl(142 76% 46%)',       // Cool green for negative
        gradientStart: 'hsl(142 76% 46%)',
        gradientEnd: 'hsl(142 76% 46%)',
      };
    }
  }, [overallTrend]);

  // Calculate current period best/worst stocks (across all data points)
  const periodStats = useMemo(() => {
    if (!performanceData.length) return { best: undefined, worst: undefined };
    
    let best: StockPerf | undefined;
    let worst: StockPerf | undefined;
    
    performanceData.forEach(p => {
      if (p.topStock && (!best || p.topStock.returnPct > best.returnPct)) {
        best = p.topStock;
      }
      if (p.bottomStock && (!worst || p.bottomStock.returnPct < worst.returnPct)) {
        worst = p.bottomStock;
      }
    });
    
    return { best, worst };
  }, [performanceData]);

  // Get selected point data
  const selectedData = useMemo(() => {
    if (!selectedPoint) return null;
    return performanceData.find(p => p.label === selectedPoint);
  }, [selectedPoint, performanceData]);

  // Chart data
  const chartData = useMemo(() => {
    return performanceData.map(p => ({
      ...p,
      isSelected: p.label === selectedPoint,
    }));
  }, [performanceData, selectedPoint]);

  // Handle chart point click
  const handlePointClick = (data: PeriodPerformance) => {
    if (selectedPoint === data.label) {
      setIsExpanded(!isExpanded);
    } else {
      setSelectedPoint(data.label);
      setIsExpanded(true);
    }
  };

   // Handle stock click to open sheet
   const handleStockClick = (stock: StockTradeDetail) => {
     setSelectedStock(stock);
     setIsSheetOpen(true);
   };
 
  // Top/Bottom 5 stocks for selected point
  const { top5, bottom5 } = useMemo(() => {
    if (!selectedData?.stocks) return { top5: [], bottom5: [] };
    const sorted = [...selectedData.stocks].sort((a, b) => b.returnPct - a.returnPct);
    return {
      top5: sorted.slice(0, 5),
      bottom5: sorted.slice(-5).reverse(),
    };
  }, [selectedData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: PeriodPerformance }> }) => {
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 dark:bg-white/10 backdrop-blur-sm border dark:border-white/10 rounded-lg p-2 shadow-lg text-xs">
        <div className="font-medium text-foreground">{data.label}</div>
        <div className={data.returnPct >= 0 ? "text-success" : "text-destructive"}>
          報酬率: {data.returnPct >= 0 ? "+" : ""}{data.returnPct.toFixed(1)}%
        </div>
      </div>
    );
  };

  // Period label
  const getPeriodLabel = (p: ViewPeriod) => {
    switch (p) {
      case "yearly": return "年績效";
      case "monthly": return "月績效";
      case "weekly": return "週績效";
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Segmented Control */}
        <Tabs 
          value={period} 
          onValueChange={(v) => {
            setPeriod(v as ViewPeriod);
            setSelectedPoint(null);
            setIsExpanded(false);
          }}
        >
          <TabsList className="grid w-full grid-cols-3 bg-muted/30 dark:bg-white/[0.02] p-1 h-11">
            <TabsTrigger 
              value="yearly" 
              className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              年績效
            </TabsTrigger>
            <TabsTrigger 
              value="monthly" 
              className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              月績效
            </TabsTrigger>
            <TabsTrigger 
              value="weekly" 
              className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              週績效
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Chart Area with Floating Card */}
        <div className="space-y-3">
          {/* Floating Stat Card - moved above chart */}
          <div className="flex justify-end">
            <FloatingStatCard 
              bestStock={periodStats.best}
              worstStock={periodStats.worst}
            />
          </div>

          {/* Area Chart */}
          <div className="h-52 px-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 16, right: 16, left: 8, bottom: 8 }}
                onClick={(e) => {
                  if (e && e.activePayload && e.activePayload[0]) {
                    handlePointClick(e.activePayload[0].payload);
                  }
                }}
              >
                <defs>
                  <linearGradient id={`colorReturn-${period}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.gradientStart} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={chartColors.gradientEnd} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="label" 
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                  domain={['dataMin - 2', 'dataMax + 2']}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="returnPct"
                  stroke={chartColors.stroke}
                  strokeWidth={2}
                  fill={`url(#colorReturn-${period})`}
                  animationDuration={500}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const isSelected = payload.label === selectedPoint;
                    return (
                      <circle
                        key={payload.label}
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 6 : 4}
                        fill={isSelected ? chartColors.stroke : "hsl(var(--background))"}
                        stroke={chartColors.stroke}
                        strokeWidth={2}
                        style={{ cursor: 'pointer' }}
                        className="transition-all duration-200"
                      />
                    );
                  }}
                  activeDot={{
                    r: 6,
                    fill: chartColors.stroke,
                    stroke: "hsl(var(--background))",
                    strokeWidth: 2,
                    cursor: "pointer",
                    onClick: (e: any) => {
                      if (e && e.payload) {
                        handlePointClick(e.payload);
                      }
                    },
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Click hint */}
          {!selectedPoint && (
            <p className="text-xs text-muted-foreground dark:text-white/50 text-center py-2">
              點擊圖表節點查看個股排名
            </p>
          )}
        </div>

        {/* Collapsible Stock Ranking */}
        {selectedPoint && (
          <Collapsible 
            open={isExpanded}
            onOpenChange={setIsExpanded}
          >
            <CollapsibleTrigger 
              className="flex items-center justify-between w-full py-2.5 px-4 rounded-lg bg-muted/40 dark:bg-white/[0.04] border border-transparent dark:border-white/10 text-sm hover:bg-muted/60 dark:hover:bg-white/[0.08] transition-colors"
            >
              <span className="font-medium text-foreground">
                {selectedPoint} 個股排名
              </span>
              <ChevronDown className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                isExpanded && "rotate-180"
              )} />
            </CollapsibleTrigger>
            
            <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
              <div className="grid grid-cols-2 gap-4 pt-3">
                {/* Top 5 */}
                <div className="bg-success/5 dark:bg-success/10 rounded-lg p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                    表現最佳
                  </h4>
                  <div className="space-y-1.5">
                    {top5.map((stock, idx) => (
                       <button
                        key={stock.symbol}
                         onClick={() => handleStockClick(stock)}
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
                    {top5.length === 0 && (
                      <p className="text-xs text-muted-foreground">無資料</p>
                    )}
                  </div>
                </div>

                {/* Bottom 5 */}
                <div className="bg-destructive/5 dark:bg-destructive/10 rounded-lg p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                    表現最差
                  </h4>
                  <div className="space-y-1.5">
                    {bottom5.map((stock, idx) => (
                       <button
                        key={stock.symbol}
                         onClick={() => handleStockClick(stock)}
                         className="flex items-center justify-between w-full text-xs py-1.5 px-1 -mx-1 rounded hover:bg-destructive/10 dark:hover:bg-destructive/20 transition-colors cursor-pointer text-left"
                      >
                        <span className="text-foreground">
                          <span className="text-muted-foreground/70 mr-1.5 tabular-nums">{idx + 1}.</span>
                          {stock.name}
                        </span>
                         <div className="flex items-center gap-1">
                           <span className="text-destructive font-medium tabular-nums">
                          {stock.returnPct.toFixed(1)}%
                           </span>
                           <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                         </div>
                       </button>
                    ))}
                    {bottom5.length === 0 && (
                      <p className="text-xs text-muted-foreground">無資料</p>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
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
}
