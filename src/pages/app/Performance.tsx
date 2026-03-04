import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
import { 
  BarChart3, TrendingUp, TrendingDown, Target, Percent, Calendar,
  ArrowUpRight, ArrowDownRight, Activity, Trophy, Zap, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useExpertPerformance } from '@/hooks/usePerformance';

export default function Performance() {
  const { user } = useAuth();

  // Get user's first subscribed expert ID
  const { data: subData } = useQuery({
    queryKey: ['perf-sub-expert', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('member_subscriptions')
        .select('expert_plans(expert_id)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);
      return (data?.[0] as any)?.expert_plans?.expert_id || null;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: perf, isLoading } = useExpertPerformance(subData || undefined);

  // Fetch recent closed trades
  const { data: recentTrades = [] } = useQuery({
    queryKey: ['perf-recent-trades', subData],
    queryFn: async () => {
      if (!subData) return [];
      const { data } = await supabase
        .from('trade_records')
        .select('*')
        .eq('expert_id', subData)
        .in('status', ['closed', 'stopped'])
        .order('exit_date', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!subData,
    staleTime: 60_000,
  });

  const stats = perf || {
    total_trades: 0, win_rate: 0, cumulative_return: 0,
    max_drawdown: 0, profit_factor: 0, avg_hold_days: 0, total_pnl: 0,
  };

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-signals-accent to-signals-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.5)]">
                  <BarChart3 className="h-6 w-6 text-white" />
                </div>
              </div>
              <div>
                <p className="text-xs text-signals-accent font-semibold tracking-wider uppercase">績效統計</p>
                <h1 className="text-xl font-bold">你的跟單成績單</h1>
              </div>
            </div>
            <Badge variant="outline" className="text-xs border-signals-accent/30">統計至今日</Badge>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Total Return */}
            <FeatureCard theme="signals" variant="highlight" className="p-6 text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Trophy className="h-5 w-5 text-signals-accent" /><span className="text-sm text-muted-foreground">累計報酬率</span>
              </div>
              <p className={cn("text-5xl font-bold flex items-center justify-center gap-3", stats.cumulative_return >= 0 ? "text-success" : "text-destructive")}>
                {stats.cumulative_return >= 0 ? <TrendingUp className="h-10 w-10" /> : <TrendingDown className="h-10 w-10" />}
                <span className={cn(stats.cumulative_return >= 0 && "drop-shadow-[0_0_20px_hsl(var(--success)/0.6)]")}>
                  {stats.cumulative_return >= 0 ? '+' : ''}{stats.cumulative_return}%
                </span>
              </p>
            </FeatureCard>

            {/* Key Metrics */}
            <section>
              <SectionHeader number="01" tag="關鍵指標" title="核心數據" icon={<Zap className="h-3.5 w-3.5" />} theme="signals" className="mb-4" />
              <div className="grid grid-cols-2 gap-3">
                <StatCard number="01" label="勝率" value={`${stats.win_rate}%`} icon={<Target className="h-5 w-5 mx-auto" />} theme="signals" />
                <StatCard number="02" label="總交易數" value={stats.total_trades} icon={<Activity className="h-5 w-5 mx-auto" />} theme="signals" />
                <StatCard number="03" label="平均持有" value={`${stats.avg_hold_days}天`} icon={<Calendar className="h-5 w-5 mx-auto" />} theme="default" />
                <StatCard number="04" label="最大回撤" value={`${stats.max_drawdown}%`} icon={<Percent className="h-5 w-5 mx-auto" />} theme="destructive" />
              </div>
            </section>

            {/* Win Rate Progress */}
            <FeatureCard theme="signals" className="p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium flex items-center gap-2"><Target className="h-4 w-4 text-signals-accent" />勝率表現</span>
                <span className="text-xl font-bold text-signals-accent">{stats.win_rate}%</span>
              </div>
              <GlowProgress value={stats.win_rate} theme="signals" size="lg" />
            </FeatureCard>

            {/* Detailed Stats */}
            <section>
              <SectionHeader number="02" tag="進階分析" title="進階指標" theme="signals" className="mb-4" />
              <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
                <div className="flex justify-between items-center p-4"><span className="text-sm text-muted-foreground">獲利因子</span><span className="font-bold text-lg">{stats.profit_factor}</span></div>
                <div className="flex justify-between items-center p-4"><span className="text-sm text-muted-foreground">累計損益</span><span className={cn("font-bold text-lg", stats.total_pnl >= 0 ? "text-success" : "text-destructive")}>{stats.total_pnl >= 0 ? '+' : ''}{stats.total_pnl}%</span></div>
              </FeatureCard>
            </section>

            {/* Recent Trades */}
            {recentTrades.length > 0 && (
              <section>
                <SectionHeader number="03" tag="交易紀錄" title="近期已結算交易" theme="signals" className="mb-4" />
                <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
                  {recentTrades.map((trade) => (
                    <div key={trade.id} className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{trade.instrument}</p>
                        <p className="text-xs text-muted-foreground">
                          {trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : '—'}
                        </p>
                      </div>
                      {trade.pnl_percent != null && (
                        <div className={cn("flex items-center gap-1 font-bold text-lg", trade.pnl_percent >= 0 ? "text-success" : "text-destructive")}>
                          {trade.pnl_percent >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                          <span>{trade.pnl_percent > 0 ? '+' : ''}{trade.pnl_percent}%</span>
                        </div>
                      )}
                    </div>
                  ))}
                </FeatureCard>
              </section>
            )}
          </>
        )}
      </div>
    </UnifiedAppLayout>
  );
}
