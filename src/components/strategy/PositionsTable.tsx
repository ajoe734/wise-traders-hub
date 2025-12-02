// Current Positions Table Component
import { cn } from '@/lib/utils';
import { Position } from '@/types/strategy';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface PositionsTableProps {
  positions: Position[];
  isDelayed?: boolean;
  className?: string;
}

export function PositionsTable({ positions, isDelayed, className }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        目前無持股
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">現有持股</h3>
        {isDelayed && (
          <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
            T+7 教學用
          </Badge>
        )}
      </div>

      {/* Mobile: Cards */}
      <div className="space-y-2 md:hidden">
        {positions.map((pos) => (
          <div 
            key={pos.symbol}
            className="p-3 bg-muted/30 rounded-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-medium">{pos.symbol}</span>
                {pos.name && (
                  <span className="text-xs text-muted-foreground ml-1">
                    {pos.name}
                  </span>
                )}
              </div>
              <Badge 
                variant="outline" 
                className={cn(
                  "text-xs",
                  pos.side === '多' ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                )}
              >
                {pos.side}
              </Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">成本</span>
                <span className="ml-1">${pos.avgPrice.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">現價</span>
                <span className="ml-1">${pos.lastPrice.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">損益</span>
                <span className={cn(
                  "ml-1 font-medium",
                  pos.pnlPct >= 0 ? "text-success" : "text-destructive"
                )}>
                  {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">比重</span>
                <span className="ml-1">{pos.weightPct}%</span>
              </div>
            </div>

            {pos.sector && (
              <div className="mt-2 text-xs text-muted-foreground">
                產業：{pos.sector}
              </div>
            )}
            {pos.note && (
              <div className="mt-1 text-xs text-mentor">
                {pos.note}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-2 font-medium text-muted-foreground">標的</th>
              <th className="text-center py-2 px-1 font-medium text-muted-foreground">方向</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">成本</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">現價</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">損益%</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">比重</th>
              <th className="text-left py-2 px-2 font-medium text-muted-foreground">產業</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr key={pos.symbol} className="border-b border-muted/50">
                <td className="py-2 px-2">
                  <div className="font-medium">{pos.symbol}</div>
                  {pos.name && (
                    <div className="text-xs text-muted-foreground">{pos.name}</div>
                  )}
                </td>
                <td className="text-center py-2 px-1">
                  {pos.side === '多' ? (
                    <TrendingUp className="h-4 w-4 text-success inline" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-destructive inline" />
                  )}
                </td>
                <td className="text-right py-2 px-2">${pos.avgPrice.toLocaleString()}</td>
                <td className="text-right py-2 px-2">${pos.lastPrice.toLocaleString()}</td>
                <td className={cn(
                  "text-right py-2 px-2 font-medium",
                  pos.pnlPct >= 0 ? "text-success" : "text-destructive"
                )}>
                  {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(2)}%
                </td>
                <td className="text-right py-2 px-2">{pos.weightPct}%</td>
                <td className="text-left py-2 px-2 text-muted-foreground">{pos.sector || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
