import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  pnlColor, fmtPct, fmtDate, fmtPrice, parseInstrument, periodLabel,
  type RealizedRow, type RealizedPeriod,
} from '@/pages/_adminPerformance/types';

interface Props {
  realizedPeriod: RealizedPeriod;
  setRealizedPeriod: (p: RealizedPeriod) => void;
  expertRole: string | null;
  realizedRows: RealizedRow[];
  realizedLoading: boolean;
  summary: { count: number; totalPct: number; winRate: number };
}

export default function RealizedTab({
  realizedPeriod, setRealizedPeriod, expertRole,
  realizedRows, realizedLoading, summary,
}: Props) {
  return (
    <div className="space-y-4">
      {/* 期間篩選 */}
      <div className="flex items-center gap-2">
        {(['week', 'month', 'year'] as RealizedPeriod[]).map(p => (
          <button
            key={p}
            onClick={() => setRealizedPeriod(p)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              realizedPeriod === p
                ? expertRole === 'mentor'
                  ? 'bg-mentor text-white'
                  : 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {periodLabel[p]}
          </button>
        ))}
      </div>

      {/* 摘要卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">交易筆數</p>
            <p className="text-2xl font-bold tabular-nums">{summary.count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">平均報酬</p>
            <p className={cn('text-2xl font-bold tabular-nums', pnlColor(summary.totalPct))}>
              {summary.count > 0 ? fmtPct(summary.totalPct) : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">勝率</p>
            <p className="text-2xl font-bold tabular-nums">
              {summary.count > 0 ? `${summary.winRate.toFixed(0)}%` : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 已實現交易列表 */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">進場價</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">出場價</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">報酬</th>
                  <th className="text-center p-3 text-xs font-medium text-muted-foreground">出場日</th>
                </tr>
              </thead>
              <tbody>
                {realizedLoading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      載入中...
                    </td>
                  </tr>
                ) : realizedRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                      {periodLabel[realizedPeriod]}無已實現交易紀錄
                    </td>
                  </tr>
                ) : (
                  realizedRows.map(row => {
                    const { symbol, name } = parseInstrument(row.instrument);
                    return (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{name || symbol}</span>
                            <span className="text-xs text-muted-foreground">{symbol}</span>
                          </div>
                        </td>
                        <td className="text-right p-3 text-sm tabular-nums">
                          {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                        </td>
                        <td className="text-right p-3 text-sm tabular-nums">
                          {row.exit_price != null ? row.exit_price.toLocaleString() : '-'}
                        </td>
                        <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor(row.pnl_percent))}>
                          {row.pnl_percent != null ? fmtPct(row.pnl_percent) : '-'}
                        </td>
                        <td className="text-center p-3 text-sm text-muted-foreground">
                          {fmtDate(row.exit_date)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
