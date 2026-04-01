// PerformanceOverviewPanel.tsx
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { FloatingStatCard, StockPerf } from "./FloatingStatCard";
import { StockTradeDetailSheet, StockTradeDetail } from "./StockTradeDetailSheet";
import { cn } from "@/lib/utils";
import { useExpert } from "@/hooks/useExpert";
import { useExpertPerformance } from "@/hooks/usePerformance";
import { usePeriodPerformance, PeriodBucket } from "@/hooks/usePeriodPerformance";

type ViewPeriod = "yearly" | "monthly" | "weekly";

const INITIAL_CAPITAL = 1_000_000;

interface PerformanceOverviewPanelProps {
  expertSlug: string;
  variant?: 'advisor' | 'mentor';
}

export function PerformanceOverviewPanel({ expertSlug, variant = 'advisor' }: PerformanceOverviewPanelProps) {
  const [period, setPeriod] = useState<ViewPeriod>("monthly");
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockTradeDetail | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Resolve slug → expert ID
  const { data: expert } = useExpert(expertSlug);
  const expertId = expert?.id;

  // Fetch overall performance
  const { data: perfData } = useExpertPerformance(expertId);
  const sinceInceptionReturn = perfData?.cumulative_return ?? 0;

  // Fetch period-bucketed data
  const { data: performanceData = [], isLoading } = usePeriodPerformance(expertId, period);

  const currentAsset = useMemo(() => {
    return Math.round(INITIAL_CAPITAL * (1 + sinceInceptionReturn / 100));
  }, [sinceInceptionReturn]);

  // Overall trend for chart color
  const overallTrend = useMemo(() => {
    return sinceInceptionReturn >= 0 ? 'positive' : 'negative';
  }, [sinceInceptionReturn]);

  const chartColors = useMemo(() => {
    if (sinceInceptionReturn >= 0) {
      return { stroke: '#E53935', gradientStart: '#E53935', gradientEnd: '#E53935' };
    }
    return { stroke: '#22C55E', gradientStart: '#22C55E', gradientEnd: '#22C55E' };
  }, [sinceInceptionReturn]);

  const periodStats = useMemo(() => {
    if (!performanceData.length) return { best: undefined, worst: undefined };
    let best: StockPerf | undefined;
    let worst: StockPerf | undefined;
    performanceData.forEach(p => {
      if (p.topStock && (!best || p.topStock.returnPct > best.returnPct)) best = p.topStock;
      if (p.bottomStock && (!worst || p.bottomStock.returnPct < worst.returnPct)) worst = p.bottomStock;
    });
    return { best, worst };
  }, [performanceData]);

  const selectedData = useMemo(() => {
    if (!selectedPoint) return null;
    return performanceData.find(p => p.label === selectedPoint);
  }, [selectedPoint, performanceData]);

  const chartData = performanceData;

  const handlePointClick = (data: PeriodBucket) => {
    if (selectedPoint === data.label) {
      setIsExpanded(!isExpanded);
    } else {
      setSelectedPoint(data.label);
      setIsExpanded(true);
    }
  };

  const handleStockClick = (stock: StockTradeDetail) => {
    setSelectedStock(stock);
    setIsSheetOpen(true);
  };

  const { top5, bottom5 } = useMemo(() => {
    if (!selectedData?.stocks) return { top5: [], bottom5: [] };
    const sorted = [...selectedData.stocks].sort((a, b) => b.returnPct - a.returnPct);
    return { top5: sorted.slice(0, 5), bottom5: sorted.slice(-5).reverse() };
  }, [selectedData]);

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: any }> }) => {
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 dark:bg-white/10 backdrop-blur-sm border dark:border-white/10 rounded-lg p-2 shadow-lg text-xs">
        <div className="font-medium text-foreground">{data.label}</div>
        <div className={data.cumReturnPct >= 0 ? "text-success" : "text-destructive"}>
          累積報酬: {data.cumReturnPct >= 0 ? "+" : ""}{data.cumReturnPct.toFixed(1)}%
        </div>
        <div className={data.returnPct >= 0 ? "text-success/80" : "text-destructive/80"}>
          本期: {data.returnPct >= 0 ? "+" : ""}{data.returnPct.toFixed(1)}%
        </div>
      </div>
    );
  };

  const tabClass = `text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border-b-2 ${variant === 'mentor' ? 'data-[state=active]:border-mentor data-[state=active]:text-mentor' : 'data-[state=active]:border-advisor data-[state=active]:text-advisor'}`;

  // Build returnPct curve for chart Y-axis
  const returnCurve = useMemo(() => {
    let cumReturn = 0;
    return performanceData.map(p => {
      cumReturn += p.returnPct;
      return { ...p, cumReturnPct: parseFloat(cumReturn.toFixed(2)), isSelected: p.label === selectedPoint };
    });
  }, [performanceData, selectedPoint]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Segmented Control */}
        <Tabs
          value={period}
          onValueChange={(v) => { setPeriod(v as ViewPeriod); setSelectedPoint(null); setIsExpanded(false); }}
        >
          <TabsList className="grid w-full grid-cols-3 bg-muted/30 dark:bg-white/[0.02] p-1 h-11">
            <TabsTrigger value="yearly" className={tabClass}>年績效</TabsTrigger>
            <TabsTrigger value="monthly" className={tabClass}>月績效</TabsTrigger>
            <TabsTrigger value="weekly" className={tabClass}>週績效</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/30 dark:bg-white/[0.03] border dark:border-white/10 p-3">
          <div>
            <div className="text-xs text-muted-foreground">起始資金</div>
            <div className="text-lg font-bold text-foreground">${INITIAL_CAPITAL.toLocaleString()}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">目前資產</div>
            <div className="text-lg font-bold text-foreground">${currentAsset.toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">總報酬率</div>
            <div className={cn("text-lg font-bold", sinceInceptionReturn >= 0 ? "text-success" : "text-destructive")}>
              {sinceInceptionReturn >= 0 ? "+" : ""}{sinceInceptionReturn.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="space-y-3">
          <div className="flex justify-end">
            <FloatingStatCard bestStock={periodStats.best} worstStock={periodStats.worst} />
          </div>

          <div className="h-52 px-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={returnCurve.length > 0 ? returnCurve : [{ label: '', returnPct: 0 }]}
                  margin={{ top: 16, right: 16, left: 8, bottom: 8 }}
                  onClick={(e) => {
                    if (e?.activePayload?.[0] && returnCurve.length > 0) {
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
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  {returnCurve.length > 0 && (
                    <Area
                      type="monotone"
                      dataKey="cumReturnPct"
                      stroke={chartColors.stroke}
                      strokeWidth={2}
                      fill={`url(#colorReturn-${period})`}
                      animationDuration={500}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        const isSelected = payload.label === selectedPoint;
                        return (
                          <circle key={payload.label} cx={cx} cy={cy} r={isSelected ? 6 : 4}
                            fill={isSelected ? chartColors.stroke : "hsl(var(--background))"}
                            stroke={chartColors.stroke} strokeWidth={2} style={{ cursor: 'pointer' }}
                            className="transition-all duration-200"
                          />
                        );
                      }}
                      activeDot={{
                        r: 6, fill: chartColors.stroke, stroke: "hsl(var(--background))", strokeWidth: 2, cursor: "pointer",
                        onClick: (e: any) => { if (e?.payload) handlePointClick(e.payload); },
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {!selectedPoint && !isLoading && (
            <p className="text-xs text-muted-foreground dark:text-white/50 text-center py-2">
              {returnCurve.length > 0 ? '點擊圖表節點查看個股排名' : '尚無已結算的交易紀錄'}
            </p>
          )}
        </div>

        {/* Collapsible Stock Ranking */}
        {selectedPoint && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2.5 px-4 rounded-lg bg-muted/40 dark:bg-white/[0.04] border border-transparent dark:border-white/10 text-sm hover:bg-muted/60 dark:hover:bg-white/[0.08] transition-colors">
              <span className="font-medium text-foreground">{selectedPoint} 個股排名</span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isExpanded && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
              <div className="grid grid-cols-2 gap-4 pt-3">
                <StockRankingList stocks={top5} type="top" onStockClick={handleStockClick} />
                <StockRankingList stocks={bottom5} type="bottom" onStockClick={handleStockClick} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      <StockTradeDetailSheet stock={selectedStock} open={isSheetOpen} onOpenChange={setIsSheetOpen} periodLabel={selectedPoint || undefined} />
    </Card>
  );
}

// Sub-component for stock ranking lists
function StockRankingList({ stocks, type, onStockClick }: {
  stocks: StockTradeDetail[];
  type: 'top' | 'bottom';
  onStockClick: (s: StockTradeDetail) => void;
}) {
  const isTop = type === 'top';
  return (
    <div className={cn("rounded-lg p-3 space-y-2", isTop ? "bg-success/5 dark:bg-success/10" : "bg-destructive/5 dark:bg-destructive/10")}>
      <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        {isTop ? <TrendingUp className="h-3.5 w-3.5 text-success" /> : <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
        {isTop ? '表現最佳' : '表現最差'}
      </h4>
      <div className="space-y-1.5">
        {stocks.map((stock, idx) => (
          <button key={stock.symbol + idx} onClick={() => onStockClick(stock)}
            className={cn("flex items-center justify-between w-full text-xs py-1.5 px-1 -mx-1 rounded transition-colors cursor-pointer text-left",
              isTop ? "hover:bg-success/10 dark:hover:bg-success/20" : "hover:bg-destructive/10 dark:hover:bg-destructive/20"
            )}
          >
            <span className="text-foreground">
              <span className="text-muted-foreground/70 mr-1.5 tabular-nums">{idx + 1}.</span>
              {stock.name}
            </span>
            <div className="flex items-center gap-1">
              <span className={cn("font-medium tabular-nums", isTop ? "text-success" : "text-destructive")}>
                {stock.returnPct >= 0 ? "+" : ""}{stock.returnPct.toFixed(1)}%
              </span>
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            </div>
          </button>
        ))}
        {stocks.length === 0 && <p className="text-xs text-muted-foreground">無資料</p>}
      </div>
    </div>
  );
}
