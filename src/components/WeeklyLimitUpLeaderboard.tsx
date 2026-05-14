import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Trophy, Flame, ArrowRight, Target } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { avatarUrl } from '@/lib/imageTransform';

export interface LeaderboardEntry {
  rank: number;
  expertId: string;
  expertSlug: string;
  name: string;
  avatarUrl: string;
  limitUpCount: number;
  winRate: number;
  weeklyReturn: number;
  isHighlighted?: boolean;
}

interface WeeklyLimitUpLeaderboardProps {
  entries: LeaderboardEntry[];
  weekLabel?: string;
  className?: string;
  isLoading?: boolean;
}

const rankStyles = {
  1: { badge: 'bg-gradient-to-r from-yellow-400 to-amber-500 text-white', icon: '🥇' },
  2: { badge: 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-800', icon: '🥈' },
  3: { badge: 'bg-gradient-to-r from-amber-600 to-amber-700 text-white', icon: '🥉' },
};

export function WeeklyLimitUpLeaderboard({ 
  entries, 
  weekLabel = '本週',
  className,
  isLoading,
}: WeeklyLimitUpLeaderboardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3 bg-gradient-to-r from-advisor/10 to-transparent">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            {weekLabel}漲停王排行榜
          </CardTitle>
          <Badge variant="advisor" className="animate-pulse">
            <Flame className="h-3 w-3 mr-1" />
            每日更新
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          基於本週持有標的命中漲停的次數排名
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
              <Skeleton className="h-8 w-10" />
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
          ))
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            本週尚無漲停命中紀錄
          </div>
        ) : (
          entries.map((entry) => {
            const rankStyle = rankStyles[entry.rank as keyof typeof rankStyles];
            return (
              <div
                key={entry.expertId}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-all hover:shadow-md",
                  entry.isHighlighted 
                    ? "bg-advisor/5 border-advisor/30 ring-1 ring-advisor/20" 
                    : "bg-card border-border hover:border-advisor/30"
                )}
              >
                <div className="flex-shrink-0 w-10 text-center">
                  {rankStyle ? (
                    <span className="text-2xl">{rankStyle.icon}</span>
                  ) : (
                    <span className="text-lg font-bold text-muted-foreground">#{entry.rank}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar className="h-10 w-10 border-2 border-background shadow-sm">
                    <AvatarImage src={avatarUrl(entry.avatarUrl, 80)} alt={entry.name} loading="lazy" decoding="async" className="object-[center_15%]" />
                    <AvatarFallback>{entry.name[0]}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{entry.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Target className="h-3 w-3" />
                        勝率 {entry.winRate}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <Flame className="h-4 w-4 text-advisor" />
                    <span className="text-lg font-bold text-advisor">{entry.limitUpCount}</span>
                    <span className="text-xs text-muted-foreground">檔</span>
                  </div>
                  <p className={cn(
                    "text-xs font-medium",
                    entry.weeklyReturn >= 0 ? "text-success" : "text-destructive"
                  )}>
                    {entry.weeklyReturn >= 0 ? '+' : ''}{entry.weeklyReturn.toFixed(1)}%
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="flex-shrink-0" asChild>
                  <Link to={`/expert/${entry.expertSlug}`}>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            );
          })
        )}
        
        <Button variant="outline" className="w-full mt-2" asChild>
          <Link to="/experts?role=advisor">
            查看所有投顧分析師
            <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
