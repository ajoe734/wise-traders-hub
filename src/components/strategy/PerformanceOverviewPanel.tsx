import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { FloatingStatCard, StockPerf } from "./FloatingStatCard";
import { getPerformanceByPeriod, PeriodPerformance } from "@/data/strategyMockData";

type ViewPeriod = "yearly" | "monthly" | "weekly";

interface PerformanceOverviewPanelProps {
  expertSlug: string;
}

export function PerformanceOverviewPanel({ expertSlug }: PerformanceOverviewPanelProps) {
  const [period, setPeriod] = useState<ViewPeriod>("monthly");
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get performance data based on period
  const performanceData = useMemo(() => {
    return getPerformanceByPeriod(expertSlug, period);
  }, [expertSlug, period]);

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
          <TabsList className="grid w-full grid-cols-3 bg-muted/50 dark:bg-white/[0.03]">
            <TabsTrigger value="yearly" className="text-sm">年績效</TabsTrigger>
            <TabsTrigger value="monthly" className="text-sm">月績效</TabsTrigger>
            <TabsTrigger value="weekly" className="text-sm">週績效</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Chart Area with Floating Card */}
        <div className="relative">
          {/* Floating Stat Card */}
          <div className="absolute top-0 right-0 z-10 w-28">
            <FloatingStatCard 
              bestStock={periodStats.best}
              worstStock={periodStats.worst}
            />
          </div>

          {/* Area Chart */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 100, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorReturn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
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
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#colorReturn)"
                  animationDuration={500}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    const isSelected = payload.label === selectedPoint;
                    return (
                      <circle
                        key={payload.label}
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 6 : 4}
                        fill={isSelected ? "hsl(var(--primary))" : "hsl(var(--background))"}
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        className="cursor-pointer transition-all duration-200"
                        onClick={() => handlePointClick(payload)}
                      />
                    );
                  }}
                  activeDot={{
                    r: 6,
                    fill: "hsl(var(--primary))",
                    stroke: "hsl(var(--background))",
                    strokeWidth: 2,
                    cursor: "pointer",
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Click hint */}
          {!selectedPoint && (
            <p className="text-xs text-muted-foreground dark:text-white/50 text-center mt-2">
              點擊圖表節點查看個股排名
            </p>
          )}
        </div>

        {/* Collapsible Stock Ranking */}
        <Collapsible 
          open={isExpanded && !!selectedPoint}
          onOpenChange={(open) => {
            if (selectedPoint) {
              setIsExpanded(open);
            }
          }}
        >
          <CollapsibleTrigger 
            className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-muted/30 dark:bg-white/[0.03] border dark:border-white/10 text-sm hover:bg-muted/50 dark:hover:bg-white/[0.06] transition-colors"
          >
            <span className="font-medium text-foreground">
              {selectedPoint ? `${selectedPoint} 個股排名` : "點擊圖表查看個股"}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded && selectedPoint ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          
          <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
            <div className="grid grid-cols-2 gap-3 pt-3">
              {/* Top 5 */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground dark:text-white/60 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" />
                  表現最佳
                </h4>
                <div className="space-y-1">
                  {top5.map((stock, idx) => (
                    <div 
                      key={stock.symbol}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded bg-success/5 dark:bg-success/10"
                    >
                      <span className="text-foreground">
                        <span className="text-muted-foreground mr-1">{idx + 1}.</span>
                        {stock.name}
                      </span>
                      <span className="text-success font-medium">
                        +{stock.returnPct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                  {top5.length === 0 && (
                    <p className="text-xs text-muted-foreground">無資料</p>
                  )}
                </div>
              </div>

              {/* Bottom 5 */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground dark:text-white/60 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-destructive" />
                  表現最差
                </h4>
                <div className="space-y-1">
                  {bottom5.map((stock, idx) => (
                    <div 
                      key={stock.symbol}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded bg-destructive/5 dark:bg-destructive/10"
                    >
                      <span className="text-foreground">
                        <span className="text-muted-foreground mr-1">{idx + 1}.</span>
                        {stock.name}
                      </span>
                      <span className="text-destructive font-medium">
                        {stock.returnPct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                  {bottom5.length === 0 && (
                    <p className="text-xs text-muted-foreground">無資料</p>
                  )}
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
