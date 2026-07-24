import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { pnlColor, fmtPnl, fmtPct, fmtPrice, assetBadge, type PerfRow } from '@/pages/_adminPerformance/types';
import { formatBaseQuantity } from '@/lib/positionQuantity';
import { FxHint } from '@/components/FxHint';

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
                  rows.map(row => {
                    const badge = assetBadge(row.asset_class);
                    // 一律走 formatBaseQuantity（吃 base_quantity + preferred unit + asset_class），
                    // 禁止手動拼 `${quantity} ${unit}`，避免「1000 股 → 印成 1000 張」這種契約破口。
                    const qtyLabel = formatBaseQuantity(
                      row.base_quantity ?? row.quantity,
                      row.quantity_unit,
                      row.asset_class,
                    );
                    return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{row.name || '-'}</span>
                            {badge && (
                              <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4', badge.className)}>
                                {badge.label}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{row.symbol}</span>
                        </div>
                      </td>
                      <td className="text-right p-3 text-sm tabular-nums">
                        {qtyLabel}
                      </td>
                      <td className="text-right p-3 text-sm tabular-nums">
                        {fmtPrice(row.entry_price, row.currency, row.asset_class)}
                      </td>
                      <td className={cn('text-right p-3 text-sm tabular-nums transition-colors duration-300')}>
                        {fmtPrice(row.current_price, row.currency, row.asset_class)}
                      </td>
                      <td className={cn('text-right p-3 text-sm tabular-nums transition-colors duration-300', pnlColor(row.pnl))}>
                        {row.pnl != null ? fmtPnl(row.pnl, row.currency) : '-'}
                        {row.pnl != null && row.currency === 'USD' && (
                          <FxHint amount={row.pnl} currency="USD" showMeta={false} forceAuto className="block" />
                        )}
                      </td>
                      <td className={cn('text-right p-3 text-sm tabular-nums transition-colors duration-300', pnlColor(row.pnl_percent))}>
                        {row.pnl_percent != null ? fmtPct(row.pnl_percent) : '-'}
                      </td>
                      <td className="text-center p-3">
                        <Badge variant="default" className="text-xs">持有中</Badge>
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
