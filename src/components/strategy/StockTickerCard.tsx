import { useStockQuote } from '@/hooks/useStockQuote';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockTickerCardProps {
  symbol?: string;
  className?: string;
}

export function StockTickerCard({ symbol = '2330.TW', className }: StockTickerCardProps) {
  const { quote, loading, error, refetch } = useStockQuote(symbol, 30000);

  if (loading && !quote) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-8 w-32 mb-1" />
          <Skeleton className="h-4 w-20" />
        </CardContent>
      </Card>
    );
  }

  if (error && !quote) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">台積電 (2330)</span>
            <button onClick={refetch} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-destructive">無法取得報價</p>
        </CardContent>
      </Card>
    );
  }

  if (!quote) return null;

  const isUp = quote.change >= 0;

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            台積電 ({quote.symbol})
          </span>
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-medium",
                isUp ? "text-success border-success/30" : "text-destructive border-destructive/30"
              )}
            >
              {isUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {isUp ? '+' : ''}{quote.changePercent.toFixed(2)}%
            </Badge>
            <button
              onClick={refetch}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="重新整理"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn(
            "text-2xl font-bold tabular-nums",
            isUp ? "text-success" : "text-destructive"
          )}>
            {quote.price.toFixed(1)}
          </span>
          <span className={cn(
            "text-sm tabular-nums",
            isUp ? "text-success" : "text-destructive"
          )}>
            {isUp ? '▲' : '▼'} {Math.abs(quote.change).toFixed(1)}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          每 30 秒自動更新 • {quote.currency}
        </p>
      </CardContent>
    </Card>
  );
}
