import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { pnlColor, fmtMoney, type CapitalStatus } from '@/pages/_adminPerformance/types';
import type { Currency } from '@/lib/currency';
import { FxHint } from '@/components/FxHint';

interface Props {
  capital: CapitalStatus;
  currency?: Currency;
}

export default function CapitalSummaryCard({ capital, currency = 'TWD' }: Props) {
  const isUsd = currency === 'USD';
  return (
    <Card>
      <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-muted-foreground">起始資金</div>
          <div className="text-base font-semibold tabular-nums">
            {fmtMoney(capital.starting_capital || 0, currency)}
            {isUsd && <FxHint amount={capital.starting_capital || 0} currency={currency} showMeta={false} forceAuto />}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">可用現金</div>
          <div className={cn('text-lg font-bold tabular-nums', capital.available_cash < 0 ? 'text-destructive' : '')}>
            {fmtMoney(capital.available_cash || 0, currency)}
            {isUsd && <FxHint amount={capital.available_cash || 0} currency={currency} showMeta={false} forceAuto />}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">未平倉成本</div>
          <div className="text-base font-semibold tabular-nums">
            {fmtMoney(capital.open_cost_value || 0, currency)}
            {isUsd && <FxHint amount={capital.open_cost_value || 0} currency={currency} showMeta={false} forceAuto />}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">已實現損益</div>
          <div className={cn('text-base font-semibold tabular-nums', pnlColor(capital.realized_pnl_amount))}>
            {capital.realized_pnl_amount > 0 ? '+' : ''}{fmtMoney(capital.realized_pnl_amount || 0, currency)}
            {isUsd && <FxHint amount={capital.realized_pnl_amount || 0} currency={currency} showMeta={false} forceAuto />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
