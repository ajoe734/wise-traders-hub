import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { formatMoneyByCurrency, type Currency } from '@/lib/currency';
import type { CapitalStatus } from '@/hooks/admin/useAdminProfile';

interface Props {
  startingCapital: string;
  startingCapitalLocked: boolean;
  capitalStatus: CapitalStatus | null | undefined;
  isReadOnly: boolean;
  setStartingCapital: (v: string) => void;
  onRequestConfirm: (amount: number) => void;
  currency?: Currency;
  /** true = 已發布訊號（永久鎖定基準）；false = 未發布，仍可再調整 */
  hasPublishedSignals?: boolean;
}

export default function StartingCapitalCard({
  startingCapital, startingCapitalLocked, capitalStatus, isReadOnly,
  setStartingCapital, onRequestConfirm, currency = 'TWD',
  hasPublishedSignals = false,
}: Props) {

  const symbol = currency === 'USD' ? 'US$' : 'NT$';
  const fmt = (n: number) => formatMoneyByCurrency(n, currency);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">起始資金</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 max-w-sm">
          <Label>起始資金（{symbol} / {currency}）</Label>
          <Input
            type="number"
            value={startingCapital}
            onChange={e => setStartingCapital(e.target.value)}
            placeholder={currency === 'USD' ? '例：100000（建議 ≥ 100,000 USD）' : '例：1000000（建議 ≥ 1,000,000 TWD）'}
            disabled={startingCapitalLocked || isReadOnly}
            className={cn(isReadOnly && !startingCapitalLocked && 'bg-muted/50 cursor-not-allowed')}
          />
          {startingCapitalLocked && (
            <p className="text-xs text-muted-foreground">已有發布訊號，起始資金為績效計算基準，無法修改。</p>
          )}
          {!startingCapitalLocked && (
            <p className="text-xs text-muted-foreground">
              以 <strong>{currency}</strong> 計價；資金額度僅在「正式發布」時檢查，草稿週記不會擋。
              {currency === 'USD' && '（美股單筆常在 5,000–30,000 USD，請確保足以承接首筆買進）'}
            </p>
          )}
          {capitalStatus && startingCapitalLocked && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">目前可用現金</div>
                <div className={cn('text-sm font-semibold tabular-nums', capitalStatus.available_cash < 0 ? 'text-destructive' : '')}>
                  {fmt(capitalStatus.available_cash || 0)}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">未平倉成本</div>
                <div className="text-sm font-semibold tabular-nums">{fmt(capitalStatus.open_cost_value || 0)}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">已實現損益</div>
                <div className={cn('text-sm font-semibold tabular-nums',
                  capitalStatus.realized_pnl_amount > 0 ? 'text-red-600 dark:text-red-400' :
                  capitalStatus.realized_pnl_amount < 0 ? 'text-green-600 dark:text-green-400' : '')}>
                  {capitalStatus.realized_pnl_amount > 0 ? '+' : ''}{fmt(capitalStatus.realized_pnl_amount || 0)}
                </div>
              </div>
            </div>
          )}
        </div>
        {!startingCapitalLocked && (
          <PermissionTooltip disabled={isReadOnly}>
            <Button
              size="sm"
              disabled={!startingCapital || Number(startingCapital) <= 0 || isReadOnly}
              onClick={() => onRequestConfirm(Number(startingCapital))}
            >
              {startingCapital && !hasPublishedSignals ? '更新起始資金' : '確認設定'}
            </Button>
          </PermissionTooltip>
        )}

      </CardContent>
    </Card>
  );
}
