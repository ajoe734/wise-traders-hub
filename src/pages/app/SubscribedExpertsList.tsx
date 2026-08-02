import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';

import { FeatureCard } from '@/components/ui/feature-card';
import { 
  BarChart3, 
  ChevronRight,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useMemberSubscriptions } from '@/hooks/useMemberSubscriptions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RoleBadge } from '@/components/RoleBadge';
import { FailedIntentsCard } from '@/pages/_appSubscriptions/FailedIntentsCard';
import { SubscriptionConflictNotice } from '@/components/account/SubscriptionConflictNotice';
import { track } from '@/lib/analytics/events';

function fmtDate(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

export default function SubscribedExpertsList() {
  const { data: subs = [] } = useMemberSubscriptions();
  const hasAnySubscription = subs.length > 0;
  useEffect(() => { track('subscribed_experts_view', { count: subs.length }); }, [subs.length]);



  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)]">
                <BarChart3 className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-primary font-semibold tracking-wider uppercase">Historical Performance</p>
              <h1 className="text-xl font-bold">專家戰績</h1>
            </div>
          </div>
        </div>

        <SubscriptionConflictNotice />

        {/* Empty State */}
        {!hasAnySubscription && (
          <FeatureCard className="p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-2">尚未訂閱任何專家</p>
            <p className="text-sm text-muted-foreground mb-4">
              訂閱專家後，可以在這裡查看他們的歷史績效表現
            </p>
            <Link 
              to="/experts"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              探索專家 <ChevronRight className="h-4 w-4" />
            </Link>
          </FeatureCard>
        )}

        {/* Subscriptions list */}
        {subs.map((s) => {
          const raw = s.raw || {};
          const planName = raw.expert_plans?.name as string | undefined;
          return (
            <FeatureCard key={`${s.expert.id}-${s.plan_id}`} className="p-4">
              <Link to={`/app/expert/${s.expert.slug}`} className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  <AvatarImage src={s.expert.avatar_url ?? undefined} alt={s.expert.name} />
                  <AvatarFallback>{s.expert.name?.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{s.expert.name}</span>
                    <RoleBadge role={s.expert.role === 'advisor' ? 'advisor' : 'mentor'} size="sm" />
                  </div>
                  {planName && (
                    <div className="text-xs text-muted-foreground truncate">方案：{planName}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    生效：{fmtDate(raw.started_at)} ・ 到期：{raw.expires_at ? fmtDate(raw.expires_at) : '無期限'}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            </FeatureCard>
          );
        })}


        {/* 失敗 / 棄單訂閱 — 與 active 列分開呈現，避免被誤判為 ACTIVE */}
        <FailedIntentsCard />

        {/* Upsell CTA */}
        {hasAnySubscription && (
          <FeatureCard className="p-5 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium mb-1">想看更多厲害的專家？</p>
            <p className="text-sm text-muted-foreground mb-4">
              我們有多位專業分析師和導師等你加入
            </p>
            <Link 
              to="/experts"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              探索更多專家 <ChevronRight className="h-4 w-4" />
            </Link>
          </FeatureCard>
        )}
      </div>
    </UnifiedAppLayout>
  );
}
