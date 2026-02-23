import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Trophy, TrendingUp, Flame, ArrowRight, Target } from 'lucide-react';

interface LeaderboardEntry {
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
}

const rankStyles = {
  1: {
    badge: 'bg-gradient-to-r from-yellow-400 to-amber-500 text-white',
    icon: '🥇',
  },
  2: {
    badge: 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-800',
    icon: '🥈',
  },
  3: {
    badge: 'bg-gradient-to-r from-amber-600 to-amber-700 text-white',
    icon: '🥉',
  },
};

export function WeeklyLimitUpLeaderboard({ 
  entries, 
  weekLabel = '本週',
  className 
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
            實時更新
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          基於本週成功捕捉漲停股的次數排名
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {entries.map((entry) => {
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
              {/* Rank */}
              <div className="flex-shrink-0 w-10 text-center">
                {rankStyle ? (
                  <span className="text-2xl">{rankStyle.icon}</span>
                ) : (
                  <span className="text-lg font-bold text-muted-foreground">
                    #{entry.rank}
                  </span>
                )}
              </div>
              
              {/* Avatar & Name */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Avatar className="h-10 w-10 border-2 border-background shadow-sm">
                  <AvatarImage src={entry.avatarUrl} alt={entry.name} />
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
              
              {/* Stats */}
              <div className="flex-shrink-0 text-right">
                <div className="flex items-center gap-1 justify-end">
                  <Flame className="h-4 w-4 text-advisor" />
                  <span className="text-lg font-bold text-advisor">
                    {entry.limitUpCount}
                  </span>
                  <span className="text-xs text-muted-foreground">檔</span>
                </div>
                <p className={cn(
                  "text-xs font-medium",
                  entry.weeklyReturn >= 0 ? "text-success" : "text-destructive"
                )}>
                  {entry.weeklyReturn >= 0 ? '+' : ''}{entry.weeklyReturn.toFixed(1)}%
                </p>
              </div>
              
              {/* Link */}
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                asChild
              >
                <Link to={`/expert/${entry.expertSlug}`}>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          );
        })}
        
        {/* View All Button */}
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

// Mock leaderboard data
export const mockLeaderboardEntries: LeaderboardEntry[] = [
  {
    rank: 1,
    expertId: 'person-5',
    expertSlug: 'zhao-pengbo',
    name: '趙彭博',
    avatarUrl: '/images/experts/zhao-pengbo.png',
    limitUpCount: 8,
    winRate: 72,
    weeklyReturn: 15.8,
    isHighlighted: true,
  },
  {
    rank: 2,
    expertId: 'person-1',
    expertSlug: 'chen-advisor',
    name: '陳建宏',
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
    limitUpCount: 5,
    winRate: 62,
    weeklyReturn: 8.5,
  },
  {
    rank: 3,
    expertId: 'person-2',
    expertSlug: 'lin-advisor',
    name: '林雅婷',
    avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop',
    limitUpCount: 3,
    winRate: 78,
    weeklyReturn: 4.2,
  },
];
