import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { 
  Radio, Target, TrendingUp, ChevronRight, Flame, BarChart3, Briefcase,
  ArrowUpRight, ArrowDownRight, Clock, Zap, Trophy
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isToday, differenceInMinutes } from 'date-fns';
import { getActionMeta } from '@/lib/signalAction';
// C1 (audit 2026-06): useMyHoldings removed — see note below.
import { richHtmlPreview, PREVIEW_LIMITS } from '@/components/SafeRichHtml';

import { avatarUrl } from '@/lib/imageTransform';
import { useEffect } from 'react';
import { track } from '@/lib/analytics/events';

interface SignalsDashboardProps {
  subscriptions: any[];
  userName?: string;
}

export function SignalsDashboard({ subscriptions, userName }: SignalsDashboardProps) {
  const { user } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();

  // Fetch recent signals from DB
  const { data: recentSignals = [] } = useQuery({
    queryKey: ['dashboard-signals', effectiveUserId, isViewAs],
    queryFn: async () => {
      const { data } = await supabase
        .from('expert_signals')
        .select('*, experts!inner(name, avatar_url, slug, status)')
        .eq('status', 'published')
        .eq('experts.status', 'active')
        .order('published_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    staleTime: 30_000,
  });

  // C1（holdings audit 2026-06）：訂閱者儀表板沒有單一 expert 上下文，
  // 強制 expertId 守衛後，這裡若仍呼叫 useMyHoldings() 會永遠拿到 []，
  // 之前「顯示全站開倉」是資料外洩。已移除此呼叫，計數改為 0。
  const holdings: any[] = [];

  const todaySignals = recentSignals.filter(s => s.published_at && isToday(new Date(s.published_at)));

  useEffect(() => {
    track('holdings_dashboard_view', { holdings_count: holdings.length });
  }, [holdings.length]);

  const getActionColor = (action: string) => {
    const meta = getActionMeta(action);
    if (meta.className.includes('success')) return 'text-success';
    if (meta.className.includes('destructive')) return 'text-destructive';
    if (meta.className.includes('blue-500')) return 'text-blue-500';
    if (meta.className.includes('amber-500')) return 'text-amber-500';
    return 'text-foreground';
  };


  const getActionLabel = (action: string) => getActionMeta(action).label;


  const getTimeLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const mins = differenceInMinutes(new Date(), date);
    if (mins < 60) return `${mins} 分鐘前`;
    if (mins < 1440) return format(date, 'HH:mm');
    return format(date, 'MM/dd');
  };

  return (
    <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
      <div className="relative">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-signals-accent to-signals-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--signals-accent)/0.5)]">
              <Target className="h-6 w-6 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success animate-pulse" />
          </div>
          <div>
            <p className="text-xs text-signals-accent font-semibold tracking-wider uppercase">跟單派 · SIGNALS</p>
            <h1 className="text-xl font-bold">今日戰況，盡在掌握</h1>
          </div>
        </div>
      </div>

      <section className="animate-fade-in">
        <div className="grid grid-cols-3 gap-3">
          <StatCard number="01" label="今日訊號" value={todaySignals.length} sublabel="筆" theme="signals" glowing={todaySignals.length > 0} />
          <StatCard number="02" label="持倉" value={holdings.length} sublabel="檔" theme="signals" />
          <StatCard number="03" label="本週績效" value="—" theme="success" />
        </div>
      </section>

      <section className="animate-slide-up">
        <SectionHeader number="01" tag="即時訊號" title="最新訊號" icon={<Radio className="h-3.5 w-3.5" />} theme="signals" className="mb-4" />
        <div className="flex items-center justify-end -mt-8 mb-3">
          <Link to="/app/signals" className="text-sm text-signals-accent flex items-center gap-1 hover:underline">查看全部<ChevronRight className="h-4 w-4" /></Link>
        </div>
        
        {recentSignals.length > 0 ? (
          <div className="space-y-2">
            {recentSignals.map((signal) => (
              <Link key={signal.id} to={`/app/signal/${signal.id}`} onClick={() => track('signal_card_click', { instrument: signal.instrument, signal_id: signal.id })}>
                <FeatureCard theme="signals" className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant={signal.action === 'buy' || signal.action === 'add' ? 'advisor' : 'outline'} className="text-xs">
                          {getActionLabel(signal.action)}
                        </Badge>
                        {signal.published_at && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />{getTimeLabel(signal.published_at)}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold truncate">{signal.instrument}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{richHtmlPreview(signal.reason_summary, PREVIEW_LIMITS.dashboardRow)}</p>
                      {signal.experts && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <img src={avatarUrl(signal.experts.avatar_url, 40)} alt={signal.experts.name} loading="lazy" decoding="async" className="shrink-0 h-5 w-5 rounded-full object-cover object-[center_15%] border border-signals-accent/30" />
                          <span className="text-xs text-muted-foreground">{signal.experts.name}</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </FeatureCard>
              </Link>
            ))}
          </div>
        ) : (
          <FeatureCard theme="signals" className="p-6 text-center">
            <Radio className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">今日暫無新訊號</p>
            <p className="text-sm text-muted-foreground mt-1">訊號發出時會即時通知你</p>
          </FeatureCard>
        )}
      </section>

      <section className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <SectionHeader number="02" tag="持股狀況" title="我的持倉" icon={<Briefcase className="h-3.5 w-3.5" />} theme="signals" className="mb-4" />
        
        {holdings.length > 0 ? (
          <FeatureCard theme="signals" className="divide-y divide-foreground/[0.08]">
            {holdings.map((holding) => (
              <div key={holding.id} className="p-4 flex items-center justify-between cursor-pointer" onClick={() => track('holding_card_click', { instrument: holding.instrument, pnl_bucket: holding.pnl_percent == null ? 'na' : holding.pnl_percent >= 10 ? 'big_gain' : holding.pnl_percent >= 0 ? 'gain' : holding.pnl_percent >= -10 ? 'loss' : 'big_loss' })}>
                <div>
                  <p className="font-medium">{holding.instrument}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    買入 ${holding.entry_price}
                  </p>
                </div>
                <div className="text-right">
                  {holding.pnl_percent != null ? (
                    <p className={cn("font-semibold flex items-center gap-1 justify-end", holding.pnl_percent >= 0 ? "text-success" : "text-destructive")}>
                      {holding.pnl_percent >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {holding.pnl_percent >= 0 ? '+' : ''}{holding.pnl_percent.toFixed(2)}%
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm">—</p>
                  )}
                  {holding.current_price && <p className="text-xs text-muted-foreground">${holding.current_price}</p>}
                </div>
              </div>
            ))}
          </FeatureCard>
        ) : (
          <FeatureCard theme="signals" className="p-6 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">目前沒有持倉</p>
          </FeatureCard>
        )}
      </section>

      <section className="pt-2 space-y-2 animate-fade-in" style={{ animationDelay: '0.25s' }}>
        <Link to="/app/account" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
          <span className="text-sm text-muted-foreground">管理訂閱</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link to="/experts" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
          <span className="text-sm text-muted-foreground">探索更多專家</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </section>
    </div>
  );
}

export default SignalsDashboard;
