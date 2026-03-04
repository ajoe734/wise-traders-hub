import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BacktestMetrics {
  return1y?: number | null;
  maxDrawdown?: number | null;
  annualReturn?: number | null;
}

interface StrategyIntroSectionProps {
  summary?: string;
  metrics?: BacktestMetrics;
  variant?: 'advisor' | 'mentor';
}

export function StrategyIntroSection({ summary, metrics, variant = 'advisor' }: StrategyIntroSectionProps) {
  const accentColor = variant === 'advisor' ? 'bg-advisor' : 'bg-mentor';
  const hasMetrics = metrics && (metrics.return1y != null || metrics.maxDrawdown != null || metrics.annualReturn != null);

  return (
    <Card className="overflow-hidden">
      {/* Accent top bar */}
      <div className={cn("h-1", accentColor)} />
      <CardContent className="p-5 space-y-5">
        {/* Strategy description */}
        {summary && (
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {summary}
          </p>
        )}

        {/* Backtest metrics tiles */}
        {hasMetrics && (
          <div className="grid grid-cols-3 gap-3">
            {metrics.return1y != null && (
              <div className="bg-muted/30 dark:bg-white/[0.04] rounded-lg p-4 text-center space-y-1">
                <p className="text-xs text-muted-foreground">近 1 年報酬</p>
                <p className={cn(
                  "text-xl font-bold tabular-nums",
                  metrics.return1y >= 0 ? "text-success" : "text-destructive"
                )}>
                  {metrics.return1y >= 0 ? "+" : ""}{metrics.return1y.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground/60">回測/模擬數據，僅供參考</p>
              </div>
            )}
            {metrics.maxDrawdown != null && (
              <div className="bg-muted/30 dark:bg-white/[0.04] rounded-lg p-4 text-center space-y-1">
                <p className="text-xs text-muted-foreground">最大回撤</p>
                <p className="text-xl font-bold tabular-nums text-warning">
                  {metrics.maxDrawdown.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground/60">風險指標</p>
              </div>
            )}
            {metrics.annualReturn != null && (
              <div className="bg-muted/30 dark:bg-white/[0.04] rounded-lg p-4 text-center space-y-1">
                <p className="text-xs text-muted-foreground">年化報酬</p>
                <p className="text-xl font-bold tabular-nums text-foreground">
                  {metrics.annualReturn.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground/60">回測數據</p>
              </div>
            )}
          </div>
        )}

        {/* Disclaimer */}
        {hasMetrics && (
          <p className="text-xs text-center text-warning/80 flex items-center justify-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            以上為歷史回測或模擬數據，過去績效不代表未來表現
          </p>
        )}
      </CardContent>
    </Card>
  );
}
