import { Trophy, TrendingDown } from "lucide-react";

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
      className={`bg-background/80 dark:bg-white/10 backdrop-blur-sm border rounded-lg p-2 shadow-lg space-y-2 dark:border-white/10 animate-fade-in ${className || ''}`}
    >
      {/* 最佳個股 */}
      {bestStock && (
        <div className="text-xs">
          <div className="text-muted-foreground dark:text-white/60 flex items-center gap-1">
            <Trophy className="h-3 w-3 text-amber-500" />
            <span>本期最佳</span>
          </div>
          <div className="font-medium text-foreground">
            {bestStock.name}
            <span className="text-success ml-1">
              +{bestStock.returnPct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
      
      {/* 最差個股 */}
      {worstStock && (
        <div className="text-xs">
          <div className="text-muted-foreground dark:text-white/60 flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-destructive" />
            <span>本期最差</span>
          </div>
          <div className="font-medium text-foreground">
            {worstStock.name}
            <span className="text-destructive ml-1">
              {worstStock.returnPct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
