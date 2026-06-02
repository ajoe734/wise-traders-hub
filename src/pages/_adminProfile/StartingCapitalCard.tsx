import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import type { CapitalStatus } from '@/hooks/admin/useAdminProfile';

interface Props {
  startingCapital: string;
  startingCapitalLocked: boolean;
  capitalStatus: CapitalStatus | null | undefined;
  isReadOnly: boolean;
  setStartingCapital: (v: string) => void;
  onRequestConfirm: (amount: number) => void;
}

export default function StartingCapitalCard({
  startingCapital, startingCapitalLocked, capitalStatus, isReadOnly,
  setStartingCapital, onRequestConfirm,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">起始資金</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 max-w-sm">
          <Label>起始資金（NT$）</Label>
          <Input
            type="number"
            value={startingCapital}
            onChange={e => setStartingCapital(e.target.value)}
            placeholder="例：1000000"
            disabled={startingCapitalLocked || isReadOnly}
            className={cn(isReadOnly && !startingCapitalLocked && 'bg-muted/50 cursor-not-allowed')}
          />
          {startingCapitalLocked && (
            <p className="text-xs text-muted-foreground">起始資金已設定，無法修改。</p>
          )}
          {capitalStatus && startingCapitalLocked && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">目前可用現金</div>
                <div className={cn('text-sm font-semibold tabular-nums', capitalStatus.available_cash < 0 ? 'text-destructive' : '')}>
                  ${(capitalStatus.available_cash || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">未平倉成本</div>
                <div className="text-sm font-semibold tabular-nums">${(capitalStatus.open_cost_value || 0).toLocaleString()}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-[10px] text-muted-foreground">已實現損益</div>
                <div className={cn('text-sm font-semibold tabular-nums',
                  capitalStatus.realized_pnl_amount > 0 ? 'text-red-600 dark:text-red-400' :
                  capitalStatus.realized_pnl_amount < 0 ? 'text-green-600 dark:text-green-400' : '')}>
                  {capitalStatus.realized_pnl_amount > 0 ? '+' : ''}${(capitalStatus.realized_pnl_amount || 0).toLocaleString()}
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
              確認設定
            </Button>
          </PermissionTooltip>
        )}
      </CardContent>
    </Card>
  );
}
