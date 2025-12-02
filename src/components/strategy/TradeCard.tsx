// Trade Card Component - For Case Study Analysis
import { cn } from '@/lib/utils';
import { Trade, FactorContribution } from '@/types/strategy';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Clock, Target, Lightbulb } from 'lucide-react';
import { format } from 'date-fns';

interface TradeCardProps {
  trade: Trade;
  factors?: FactorContribution[];
  isDelayed?: boolean;
  className?: string;
}

const sideConfig: Record<string, { color: string; icon: typeof TrendingUp }> = {
  '買進': { color: 'text-success bg-success/10', icon: TrendingUp },
  '加碼': { color: 'text-success bg-success/10', icon: TrendingUp },
  '賣出': { color: 'text-destructive bg-destructive/10', icon: TrendingDown },
  '減碼': { color: 'text-warning bg-warning/10', icon: TrendingDown },
  '停損': { color: 'text-destructive bg-destructive/10', icon: TrendingDown },
};

export function TradeCard({ trade, factors, isDelayed, className }: TradeCardProps) {
  const config = sideConfig[trade.side] || sideConfig['買進'];
  const Icon = config.icon;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-lg", config.color.split(' ')[1])}>
              <Icon className={cn("h-4 w-4", config.color.split(' ')[0])} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{trade.symbol}</span>
                {trade.name && (
                  <span className="text-sm text-muted-foreground">{trade.name}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{format(new Date(trade.openTime), 'MM/dd HH:mm')}</span>
                {trade.closeTime && (
                  <>
                    <span>→</span>
                    <span>{format(new Date(trade.closeTime), 'MM/dd HH:mm')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <Badge className={config.color}>{trade.side}</Badge>
            {isDelayed && (
              <Badge variant="outline" className="ml-1 text-[10px] bg-mentor/10 text-mentor border-mentor/20">
                T+7
              </Badge>
            )}
          </div>
        </div>

        {/* Trade Details */}
        <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
          <div className="p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">價格</p>
            <p className="font-medium">${trade.price.toLocaleString()}</p>
          </div>
          {trade.holdingDays !== undefined && (
            <div className="p-2 bg-muted/30 rounded">
              <p className="text-xs text-muted-foreground">持有</p>
              <p className="font-medium">{trade.holdingDays}天</p>
            </div>
          )}
          {trade.pnlPct !== undefined && (
            <div className="p-2 bg-muted/30 rounded">
              <p className="text-xs text-muted-foreground">報酬</p>
              <p className={cn(
                "font-medium",
                trade.pnlPct >= 0 ? "text-success" : "text-destructive"
              )}>
                {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(1)}%
              </p>
            </div>
          )}
        </div>

        {/* Reason */}
        <div className="mb-3">
          <div className="flex items-center gap-1 mb-1">
            <Target className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">交易理由</span>
          </div>
          <p className="text-sm">{trade.reasonShort}</p>
        </div>

        {/* Tags */}
        {trade.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {trade.tags.map((tag, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Contributing Factors */}
        {factors && factors.length > 0 && (
          <div className="pt-3 border-t">
            <div className="flex items-center gap-1 mb-2">
              <Lightbulb className="h-3 w-3 text-warning" />
              <span className="text-xs font-medium text-muted-foreground">決策因子</span>
            </div>
            <div className="space-y-2">
              {factors.slice(0, 3).map((factor) => (
                <div key={factor.factorId} className="flex items-start gap-2">
                  <div className={cn(
                    "shrink-0 w-2 h-2 rounded-full mt-1.5",
                    factor.impact === 'High' ? "bg-success" : factor.impact === 'Medium' ? "bg-warning" : "bg-muted"
                  )} />
                  <div>
                    <p className="text-xs font-medium">{factor.name}</p>
                    <p className="text-xs text-muted-foreground">{factor.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
