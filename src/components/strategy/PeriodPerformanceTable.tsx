// Period Performance Table Component
import { cn } from '@/lib/utils';
import { PerformanceSnapshot, PerfPeriod } from '@/types/strategy';
import { Badge } from '@/components/ui/badge';

interface PeriodPerformanceTableProps {
  data: PerformanceSnapshot[];
  isDelayed?: boolean;
  className?: string;
}

const periodLabels: Record<PerfPeriod, string> = {
  '1M': '1個月',
  '3M': '3個月',
  '6M': '6個月',
  '1Y': '1年',
  'YTD': '今年',
  'SI': '成立以來',
};

export function PeriodPerformanceTable({ data, isDelayed, className }: PeriodPerformanceTableProps) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-medium">分期間績效</h3>
        {isDelayed && (
          <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
            T+7 教學用
          </Badge>
        )}
      </div>
      
      {/* Mobile: Horizontal scroll cards */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:hidden">
        {data.map((snapshot) => (
          <div 
            key={snapshot.period}
            className="flex-shrink-0 w-[140px] p-3 bg-muted/30 rounded-lg snap-start"
          >
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {periodLabels[snapshot.period]}
            </p>
            <p className={cn(
              "text-lg font-bold",
              snapshot.cumulativeReturnPct >= 0 ? "text-success" : "text-destructive"
            )}>
              {snapshot.cumulativeReturnPct >= 0 ? '+' : ''}{snapshot.cumulativeReturnPct.toFixed(1)}%
            </p>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {snapshot.maxDrawdownPct !== undefined && (
                <div className="flex justify-between">
                  <span>回撤</span>
                  <span className="text-warning">{snapshot.maxDrawdownPct.toFixed(1)}%</span>
                </div>
              )}
              {snapshot.winRatePct !== undefined && (
                <div className="flex justify-between">
                  <span>勝率</span>
                  <span>{snapshot.winRatePct.toFixed(0)}%</span>
                </div>
              )}
              {snapshot.tradesCount !== undefined && (
                <div className="flex justify-between">
                  <span>交易</span>
                  <span>{snapshot.tradesCount}筆</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: Table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-2 font-medium text-muted-foreground">期間</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">累積報酬</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">最大回撤</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">勝率</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">交易數</th>
            </tr>
          </thead>
          <tbody>
            {data.map((snapshot) => (
              <tr key={snapshot.period} className="border-b border-muted/50">
                <td className="py-2 px-2 font-medium">{periodLabels[snapshot.period]}</td>
                <td className={cn(
                  "text-right py-2 px-2 font-medium",
                  snapshot.cumulativeReturnPct >= 0 ? "text-success" : "text-destructive"
                )}>
                  {snapshot.cumulativeReturnPct >= 0 ? '+' : ''}{snapshot.cumulativeReturnPct.toFixed(1)}%
                </td>
                <td className="text-right py-2 px-2 text-warning">
                  {snapshot.maxDrawdownPct?.toFixed(1) ?? '-'}%
                </td>
                <td className="text-right py-2 px-2">
                  {snapshot.winRatePct?.toFixed(0) ?? '-'}%
                </td>
                <td className="text-right py-2 px-2">
                  {snapshot.tradesCount ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
