import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { pnlColor, fmtPnl, fmtPct, type PerfRow } from '@/pages/_adminPerformance/types';

interface Props {
  rows: PerfRow[];
  loading: boolean;
  totalPnlPercent: number | null;
  avgPnlPercent: number | null;
  count: number;
}

export default function UnrealizedTab({ rows, loading, totalPnlPercent, avgPnlPercent, count }: Props) {
  return (
    <div className="space-y-4">
      {/* 摘要卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">持倉數量</p>
            <p className="text-2xl font-bold tabular-nums">{count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">累計報酬</p>
            <p className={cn('text-2xl font-bold tabular-nums', pnlColor(totalPnlPercent))}>
              <AnimatedNumber value={totalPnlPercent} format={fmtPct} className={pnlColor(totalPnlPercent)} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">平均報酬</p>
            <p className={cn('text-2xl font-bold tabular-nums', pnlColor(avgPnlPercent))}>
              <AnimatedNumber value={avgPnlPercent} format={fmtPct} className={pnlColor(avgPnlPercent)} />
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 持倉列表 */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">數量</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">進場價</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">現價</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">損益</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">報酬</th>
                  <th className="text-center p-3 text-xs font-medium text-muted-foreground">狀態</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      載入中...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                      目前無持倉
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{row.name || '-'}</span>
                          <span className="text-xs text-muted-foreground">{row.symbol}</span>
                        </div>
                      </td>
                      <td className="text-right p-3 text-sm tabular-nums">
                        {row.quantity} {row.quantity_unit}
                      </td>
                      <td className="text-right p-3 text-sm tabular-nums">
                        {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                      </td>
                      <td className={cn('text-right p-3 text-sm tabular-nums transition-colors duration-300')}>
                        {row.current_price != null ? row.current_price.toLocaleString() : '-'}
                      </td>
                      <td className={cn('text-right p-3 text-sm tabular-nums transition-colors duration-300', pnlColor(row.pnl))}>
                        {row.pnl != null ? fmtPnl(row.pnl) : '-'}
                      </td>
                      <td className={cn('text-right p-3 text-sm tabular-nums transition-colors duration-300', pnlColor(row.pnl_percent))}>
                        {row.pnl_percent != null ? fmtPct(row.pnl_percent) : '-'}
                      </td>
                      <td className="text-center p-3">
                        <Badge variant="default" className="text-xs">持有中</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
