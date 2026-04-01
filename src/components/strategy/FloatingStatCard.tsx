import { Trophy, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StockPerf {
  symbol: string;
  name: string;
  returnPct: number;
}

interface FloatingStatCardProps {
  bestStock?: StockPerf;
  worstStock?: StockPerf;
  className?: string;
}

export function FloatingStatCard({ bestStock, worstStock, className }: FloatingStatCardProps) {
  if (!bestStock && !worstStock) return null;

  return (
    <div 
      className={cn(
        "inline-flex items-center gap-4 bg-muted/50 dark:bg-white/[0.05]",
        "backdrop-blur-sm rounded-lg px-3 py-2",
        "border border-border/50 dark:border-white/10",
        "animate-fade-in",
        className
      )}
    >
      {/* 最佳個股 */}
      {bestStock && (
        <div className="flex items-center gap-2 text-xs">
          <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-muted-foreground">最佳</span>
          <span className="font-medium text-foreground">{bestStock.name}</span>
          <span className="text-success font-semibold tabular-nums">
            +{bestStock.returnPct.toFixed(2)}%
          </span>
        </div>
      )}
      
      {/* 分隔線 */}
      {bestStock && worstStock && (
        <div className="w-px h-4 bg-border dark:bg-white/20" />
      )}
      
      {/* 最差個股 */}
      {worstStock && (
        <div className="flex items-center gap-2 text-xs">
          <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />
          <span className="text-muted-foreground">最差</span>
          <span className="font-medium text-foreground">{worstStock.name}</span>
          <span className="text-destructive font-semibold tabular-nums">
            {worstStock.returnPct.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}
