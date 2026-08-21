// PerformanceOverviewPanel.tsx
import { useState, useMemo, useEffect } from "react";
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
import { useExpertPerformance, useExpertPerformanceRealtime } from "@/hooks/usePerformance";
import { usePeriodPerformance, PeriodBucket } from "@/hooks/usePeriodPerformance";
import { useIsMobile } from "@/hooks/use-mobile";
import { useProjectionStatus } from "@/hooks/useProjectionStatus";
import { projectedAmount, projectedPercent, REVIEW_NOTE } from "@/contracts/publicProjection";
import { PerformanceReviewNotice, ReviewPlaceholder } from "@/components/expert/PerformanceReviewNotice";

type ViewPeriod = "yearly" | "monthly" | "weekly";

interface PerformanceOverviewPanelProps {
  /** 由父層直接傳入，避免本元件再查一次 experts 表 */
  expertId: string | undefined;
  /** 父層已知的起始資金；若未提供則 fallback 至 RPC 回傳值 */
  startingCapital?: number | null;
  variant?: 'advisor' | 'mentor';
  /**
   * Optional state probe for parent layout decisions (e.g. hide the whole
   * section when there is nothing public to show). Purely additive: when it
   * is not passed, rendering and queries are byte-identical to before.
   */
  onStateChange?: (state: 'loading' | 'error' | 'empty' | 'ready') => void;
}

export function PerformanceOverviewPanel({ expertId, startingCapital: startingCapitalProp, variant = 'advisor', onStateChange }: PerformanceOverviewPanelProps) {
  const [period, setPeriod] = useState<ViewPeriod>("monthly");
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockTradeDetail | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const xTickFormatter = (v: string) => {
    if (!isMobile || !v) return v;
    const parts = String(v).split('/');
    if (parts.length === 3) return `${+parts[1]}/${+parts[2]}`;
    if (parts.length === 2) return parts[1];
    return v;
  };
  const xInterval: number | 'preserveStartEnd' = !isMobile
    ? 0
    : period === 'yearly'
      ? 1
      : period === 'monthly'
        ? 'preserveStartEnd'
        : 0;
  const xMinTickGap = isMobile ? 24 : 5;
  const xAngle = period === 'monthly' ? -45 : (isMobile && period === 'yearly' ? -30 : 0);
  const xAnchor = xAngle !== 0 ? 'end' : 'middle';

  // Fetch overall performance KPIs (with realtime invalidation, scoped to detail page)
  const { data: perfData, isError: perfIsError } = useExpertPerformance(expertId);
  useExpertPerformanceRealtime(expertId);

  // R1-P public projection contract: a scope under review never renders numbers.
  const projection = useProjectionStatus(expertId);
  const capitalText = projectedAmount(projection, startingCapitalProp ?? (perfData as any)?.starting_capital ?? 0);

  // 起始資金優先用父層傳入；否則 fallback 到 RPC 回傳值
  const startingCapital = startingCapitalProp ?? (perfData as any)?.starting_capital ?? 0;
  const INITIAL_CAPITAL = startingCapital ?? 0;

  // 總報酬率（以起始資金為基準，含已實現+未實現）
  const totalReturnPct = perfData?.total_return_pct ?? 0;

  // Fetch period-bucketed data
  const { data: performanceData = [], isLoading, isError: periodIsError } = usePeriodPerformance(expertId, period, INITIAL_CAPITAL);

  // Additive state probe — never changes what this component renders.
  const panelState: 'loading' | 'error' | 'empty' | 'ready' =
    perfIsError || periodIsError
      ? 'error'
      : isLoading
        ? 'loading'
        : performanceData.length === 0
          ? 'empty'
          : 'ready';
  useEffect(() => {
    onStateChange?.(panelState);
  }, [panelState, onStateChange]);

  const currentAsset = useMemo(() => {
    // Use current_asset from RPC (now: starting + realized + unrealized when starting_capital set)
    const rpcAsset = (perfData as any)?.current_asset ?? 0;
    return Math.round(rpcAsset);
  }, [perfData]);

  // Overall trend for chart color (use total return for consistency with KPI)
  const chartColors = useMemo(() => {
    if (totalReturnPct >= 0) {
      return { stroke: '#E53935', gradientStart: '#E53935', gradientEnd: '#E53935' };
    }
    return { stroke: '#22C55E', gradientStart: '#22C55E', gradientEnd: '#22C55E' };
  }, [totalReturnPct]);

  const periodStats = useMemo(() => {
    if (!performanceData.length) return { best: undefined as StockPerf | undefined, worst: undefined as StockPerf | undefined };
    // 取最後一個 bucket 的 rangeStocks（區間級報酬，會隨週/月/年 tab 變化）
    const last = performanceData[performanceData.length - 1];
    const rs = last?.rangeStocks || [];
    if (!rs.length) return { best: undefined, worst: undefined };
    const sorted = [...rs].sort((a, b) => b.returnPct - a.returnPct);
    const top = sorted[0];
    const bot = sorted[sorted.length - 1];
    const best: StockPerf | undefined = top
      ? { symbol: top.symbol, name: top.name, returnPct: top.returnPct }
      : undefined;
    // 只有真的存在不同檔且報酬較低時才顯示 worst（單檔時只顯示 best）
    const worst: StockPerf | undefined = bot && top && bot.symbol !== top.symbol
      ? { symbol: bot.symbol, name: bot.name, returnPct: bot.returnPct }
      : undefined;
    return { best, worst };
  }, [performanceData]);

  const selectedData = useMemo(() => {
    if (!selectedPoint) return null;
    return performanceData.find(p => p.label === selectedPoint);
  }, [selectedPoint, performanceData]);

  const chartData = performanceData;
  const assetText = projectedAmount(projection, currentAsset);
  const returnText = projectedPercent(projection, totalReturnPct);

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
    const sampleCount = data.sampleCount ?? 0;
    const closedCount = data.closedCount ?? 0;
    const openCount = data.openCount ?? 0;
    return (
      <div className="bg-background/95 dark:bg-white/10 backdrop-blur-sm border dark:border-white/10 rounded-lg p-2 shadow-lg text-xs space-y-0.5 min-w-[200px]">
        <div className="font-medium text-foreground">{data.label}</div>
        <div className={data.cumReturnPct >= 0 ? "text-success" : "text-destructive"}>
          累積報酬率: {data.cumReturnPct >= 0 ? "+" : ""}{data.cumReturnPct.toFixed(2)}%
        </div>
        <div className={data.returnPct >= 0 ? "text-success/80" : "text-destructive/80"}>
          本期變動: {data.returnPct >= 0 ? "+" : ""}{data.returnPct.toFixed(2)}%
        </div>
        <div className="pt-1 mt-1 border-t border-border/60 text-[10px] text-muted-foreground leading-snug space-y-0.5">
          <div>取樣桶數：{sampleCount} 筆（已平倉 {closedCount}／未平倉 {openCount}）</div>
          <div>基準值：累積報酬率＝累積 PnL ÷ 起始資金</div>
          <div>{openCount > 0 ? '含未平倉部位（以標記價計算）' : '僅含已平倉交易'}</div>
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

        <PerformanceReviewNotice status={projection} />

        {/* Stats Bar */}
        <div
          data-economic-zone="performance-cards"
          className="grid grid-cols-3 gap-3 rounded-lg bg-muted/30 dark:bg-white/[0.03] border dark:border-white/10 p-3"
        >
          <div>
            <div className="text-xs text-muted-foreground">起始資金</div>
            <div className="text-lg font-bold text-foreground">
              {capitalText ?? <ReviewPlaceholder />}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">目前資產</div>
            <div className="text-lg font-bold text-foreground">
              {assetText ?? <ReviewPlaceholder />}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">總報酬率</div>
            {returnText ? (
              <div className={cn("text-lg font-bold", totalReturnPct >= 0 ? "text-success" : "text-destructive")}>
                {returnText}
              </div>
            ) : (
              <div className="text-lg font-bold"><ReviewPlaceholder /></div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="space-y-3">
          <div className="flex justify-end">
            <FloatingStatCard bestStock={periodStats.best} worstStock={periodStats.worst} />
          </div>

          <div data-economic-zone="performance-chart" className="h-52 px-1">
            {!projection.showNumbers ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {REVIEW_NOTE}
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={returnCurve.length > 0 ? returnCurve : [{ label: '', returnPct: 0 }]}
                  margin={{ top: 16, right: 48, left: 8, bottom: period === 'monthly' ? 48 : 8 }}
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
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} angle={xAngle} textAnchor={xAnchor} interval={xInterval as any} minTickGap={xMinTickGap} tickFormatter={xTickFormatter} />
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
        {selectedPoint && projection.showNumbers && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2.5 px-4 rounded-lg bg-muted/40 dark:bg-white/[0.04] border border-transparent dark:border-white/10 text-sm hover:bg-muted/60 dark:hover:bg-white/[0.08] transition-colors">
              <span className="font-medium text-foreground">{selectedPoint} 個股排名</span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isExpanded && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
              <div data-economic-zone="stock-ranking" className="grid grid-cols-2 gap-4 pt-3">
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
              <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            </div>
          </button>
        ))}
        {stocks.length === 0 && <p className="text-xs text-muted-foreground">無資料</p>}
      </div>
    </div>
  );
}
