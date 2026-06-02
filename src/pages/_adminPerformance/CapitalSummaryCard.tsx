import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { pnlColor, type CapitalStatus } from '@/pages/_adminPerformance/types';

interface Props {
  capital: CapitalStatus;
}

export default function CapitalSummaryCard({ capital }: Props) {
  return (
    <Card>
      <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-muted-foreground">起始資金</div>
          <div className="text-base font-semibold tabular-nums">${(capital.starting_capital || 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">可用現金</div>
          <div className={cn('text-lg font-bold tabular-nums', capital.available_cash < 0 ? 'text-destructive' : '')}>
            ${(capital.available_cash || 0).toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">未平倉成本</div>
          <div className="text-base font-semibold tabular-nums">${(capital.open_cost_value || 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">已實現損益</div>
          <div className={cn('text-base font-semibold tabular-nums', pnlColor(capital.realized_pnl_amount))}>
            {capital.realized_pnl_amount > 0 ? '+' : ''}${(capital.realized_pnl_amount || 0).toLocaleString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
