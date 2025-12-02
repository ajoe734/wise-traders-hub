// Trade Statistics Card Component
import { cn } from '@/lib/utils';
import { TradeStats } from '@/types/strategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Trophy, Target } from 'lucide-react';

interface TradeStatsCardProps {
  stats: TradeStats;
  isDelayed?: boolean;
  className?: string;
}

export function TradeStatsCard({ stats, isDelayed, className }: TradeStatsCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            交易成績拆解
          </CardTitle>
          {isDelayed && (
            <Badge variant="outline" className="text-[10px] bg-mentor/10 text-mentor border-mentor/20">
              T+7
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Win/Loss Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">總交易</span>
              <span className="font-medium">{stats.totalTrades}筆</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">獲利</span>
              <span className="font-medium text-success">{stats.winTrades}筆</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">虧損</span>
              <span className="font-medium text-destructive">{stats.loseTrades}筆</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">勝率</span>
              <span className="font-medium">{stats.winRatePct.toFixed(1)}%</span>
            </div>
            {stats.profitFactor && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">獲利因子</span>
                <span className="font-medium">{stats.profitFactor.toFixed(2)}</span>
              </div>
            )}
            {stats.avgRMultiple && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">平均R倍數</span>
                <span className="font-medium">{stats.avgRMultiple.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Avg Win/Loss */}
        <div className="pt-2 border-t">
          <div className="grid grid-cols-2 gap-3">
            {stats.avgWinPct && (
              <div className="p-2 bg-success/5 rounded-lg">
                <p className="text-xs text-muted-foreground">平均獲利</p>
                <p className="font-medium text-success">+{stats.avgWinPct.toFixed(1)}%</p>
              </div>
            )}
            {stats.avgLossPct && (
              <div className="p-2 bg-destructive/5 rounded-lg">
                <p className="text-xs text-muted-foreground">平均虧損</p>
                <p className="font-medium text-destructive">{stats.avgLossPct.toFixed(1)}%</p>
              </div>
            )}
          </div>
        </div>

        {/* Best/Worst Trade */}
        {(stats.bestTrade || stats.worstTrade) && (
          <div className="pt-2 border-t space-y-2">
            {stats.bestTrade && (
              <div className="flex items-center gap-2 text-sm">
                <Trophy className="h-4 w-4 text-success" />
                <span className="text-muted-foreground">最佳：</span>
                <span className="font-medium">{stats.bestTrade.symbol}</span>
                <span className="text-success">+{stats.bestTrade.pnlPct.toFixed(1)}%</span>
              </div>
            )}
            {stats.worstTrade && (
              <div className="flex items-center gap-2 text-sm">
                <Target className="h-4 w-4 text-destructive" />
                <span className="text-muted-foreground">最差：</span>
                <span className="font-medium">{stats.worstTrade.symbol}</span>
                <span className="text-destructive">{stats.worstTrade.pnlPct.toFixed(1)}%</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
