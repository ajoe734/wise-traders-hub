import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Activity, ShoppingCart, CreditCard, UserCheck } from 'lucide-react';

// P1: 單一使用者事件時間軸（traffic / conversions / subscriptions / payments）

type Item = {
  ts: string;
  kind: 'traffic' | 'conversion' | 'subscription' | 'payment';
  label: string;
  meta?: Record<string, unknown>;
};

export default function UserJourney() {
  const { userId = '' } = useParams<{ userId: string }>();

  const { data: profile } = useQuery({
    queryKey: ['uj-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('display_name,created_at').eq('user_id', userId).maybeSingle();
      return data as { display_name: string | null; created_at: string } | null;
    },
  });

  const { data: traffic = [] } = useQuery({
    queryKey: ['uj-traffic', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('traffic_events')
        .select('event_name,occurred_at,event_props,route')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: conversions = [] } = useQuery({
    queryKey: ['uj-conv', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversions')
        .select('id,occurred_at,utm_source,utm_campaign,channel,gross_amount,order_kind')
        .eq('user_id', userId)
        .order('occurred_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: subs = [] } = useQuery({
    queryKey: ['uj-subs', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_subscriptions')
        .select('id,plan_id,created_at,started_at,expires_at,canceled_at,status,billing_cycle')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['uj-pay', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: subRows } = await supabase
        .from('member_subscriptions')
        .select('id')
        .eq('user_id', userId!);
      const subIds = (subRows ?? []).map((r) => r.id);
      if (!subIds.length) return [] as Array<{ id: string; created_at: string; amount: number | null; status: string | null; provider_id: string | null }>;
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('id,created_at,amount,status,provider_id')
        .in('subscription_id', subIds)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; created_at: string; amount: number | null; status: string | null; provider_id: string | null }>;
    },
  });

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    for (const raw of traffic) {
      const r = raw as { event_name: string | null; occurred_at: string; event_props: unknown; route: string | null };
      list.push({
        ts: r.occurred_at,
        kind: 'traffic',
        label: r.event_name ?? 'event',
        meta: { route: r.route, ...((r.event_props as Record<string, unknown>) || {}) },
      });
    }
    for (const raw of conversions) {
      const r = raw as { occurred_at: string; utm_source: string | null; utm_campaign: string | null; channel: string | null; gross_amount: number | null; order_kind: string | null };
      list.push({
        ts: r.occurred_at,
        kind: 'conversion',
        label: `轉換 ${r.order_kind ?? ''} $${r.gross_amount ?? 0}`,
        meta: { utm_source: r.utm_source, campaign: r.utm_campaign, channel: r.channel },
      });
    }
    for (const raw of subs) {
      const r = raw as { plan_id: string | null; created_at: string; started_at: string | null; expires_at: string | null; canceled_at: string | null; status: string | null; billing_cycle: string | null };
      list.push({
        ts: r.created_at,
        kind: 'subscription',
        label: `訂閱 ${r.status} (${r.billing_cycle ?? '-'})`,
        meta: { plan_id: r.plan_id, started_at: r.started_at, expires_at: r.expires_at, canceled_at: r.canceled_at },
      });
    }
    for (const raw of payments) {
      const r = raw as { created_at: string; amount: number | null; status: string | null; provider_id: string | null };
      list.push({
        ts: r.created_at,
        kind: 'payment',
        label: `付款 ${r.status} $${r.amount ?? 0}`,
        meta: { provider_id: r.provider_id },
      });
    }
    return list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }, [traffic, conversions, subs, payments]);

  const ICONS: Record<Item['kind'], JSX.Element> = {
    traffic: <Activity className="w-3.5 h-3.5" />,
    conversion: <ShoppingCart className="w-3.5 h-3.5" />,
    subscription: <UserCheck className="w-3.5 h-3.5" />,
    payment: <CreditCard className="w-3.5 h-3.5" />,
  };
  const TONE: Record<Item['kind'], string> = {
    traffic: 'bg-muted text-foreground/70',
    conversion: 'bg-emerald-100 text-emerald-800',
    subscription: 'bg-blue-100 text-blue-800',
    payment: 'bg-amber-100 text-amber-800',
  };

  return (
    <CompanyLayout>
      <SEO title="使用者路徑｜後台分析" description="單一使用者事件時間軸，含流量、轉換、訂閱、付款。" />
      <div className="space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link to="/company/conversions" className="text-xs text-foreground/60 inline-flex items-center gap-1 hover:underline mb-2">
              <ArrowLeft className="w-3 h-3" /> 返回轉換中心
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">使用者路徑</h1>
            <p className="text-xs text-foreground/60 mt-1 font-mono">{userId}</p>
            {profile && (
              <p className="text-sm mt-1">{profile.display_name || '—'}</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(userId)}>
            複製 User ID
          </Button>
        </header>

        <FunnelDropPanel userId={userId} />


        <Card>
          <CardHeader>
            <CardTitle className="text-base">事件時間軸（最近 {items.length} 筆）</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-foreground/50">此使用者尚無事件紀錄。</p>
            ) : (
              <ol className="space-y-2">
                {items.map((it, i) => (
                  <li key={i} className="flex items-start gap-3 py-1 border-b last:border-0">
                    <div className={'mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ' + TONE[it.kind]}>
                      {ICONS[it.kind]} {it.kind}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium truncate">{it.label}</span>
                        <span className="text-[11px] text-foreground/50 tabular-nums whitespace-nowrap">
                          {new Date(it.ts).toLocaleString('zh-TW')}
                        </span>
                      </div>
                      {it.meta && Object.keys(it.meta).length > 0 && (
                        <div className="text-[11px] text-foreground/55 mt-0.5 truncate">
                          {Object.entries(it.meta)
                            .filter(([, v]) => v !== null && v !== undefined && v !== '')
                            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2 text-xs">
          <Badge variant="outline">traffic: {traffic.length}</Badge>
          <Badge variant="outline">conversions: {conversions.length}</Badge>
          <Badge variant="outline">subscriptions: {subs.length}</Badge>
          <Badge variant="outline">payments: {payments.length}</Badge>
        </div>
      </div>
    </CompanyLayout>
  );
}

function FunnelDropPanel({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['uj-funnel-drop', userId],
    enabled: !!userId,
    queryFn: async () => {
      const from = new Date(Date.now() - 30 * 86400_000).toISOString();
      const to = new Date().toISOString();
      const { data, error } = await supabase.rpc('get_user_funnel_drop', { _user_id: userId, _from: from, _to: to });
      if (error) throw error;
      return data as { steps: Array<{ step: string; reached: boolean }>; last_reached: string | null; dropped_at: string | null };
    },
  });

  const LABEL: Record<string, string> = {
    page_view: '訪站',
    expert_view: '看專家',
    plan_view: '看方案',
    checkout_view: '進入結帳',
    checkout_submit: '送出付款',
    checkout_success: '付款成功',
  };

  const ACTION: Record<string, { hint: string; href: string }> = {
    page_view: { hint: '尚未進站 — 確認對應渠道是否帶人到 /', href: '/company/traffic' },
    expert_view: { hint: '進站但沒看專家 — 檢查首頁 CTA / 推薦排序', href: '/' },
    plan_view: { hint: '看了專家但沒進方案頁 — 強化 ExpertCard CTA', href: '/company/conversions' },
    checkout_view: { hint: '看了方案但沒按結帳 — 檢查 pricing 與信任區塊', href: '/company/paywall-analytics' },
    checkout_submit: { hint: '進結帳但沒送單 — 檢查付款方式呈現', href: '/company/payments' },
    checkout_success: { hint: '送單失敗 — 看金流錯誤與審核', href: '/company/remittance' },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">漏斗反推（近 30 天）</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <p className="text-sm text-foreground/50">分析中…</p>
        ) : (
          <>
            <ol className="flex flex-wrap items-center gap-2 mb-3">
              {data.steps.map((s, idx) => (
                <li key={s.step} className="flex items-center gap-2">
                  <span
                    className={
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ' +
                      (s.reached
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-50 text-rose-700 border border-rose-200')
                    }
                  >
                    {s.reached ? '✓' : '×'} {LABEL[s.step] ?? s.step}
                  </span>
                  {idx < data.steps.length - 1 && <span className="text-foreground/30">→</span>}
                </li>
              ))}
            </ol>
            {data.dropped_at ? (
              <div className="rounded-md border bg-amber-50/60 p-3 text-sm">
                <div className="font-medium">卡關步驟：{LABEL[data.dropped_at] ?? data.dropped_at}</div>
                <div className="text-foreground/70 text-xs mt-1">{ACTION[data.dropped_at]?.hint}</div>
                {ACTION[data.dropped_at]?.href && (
                  <Link to={ACTION[data.dropped_at].href} className="text-xs text-primary hover:underline mt-1 inline-block">
                    前往對應頁面 →
                  </Link>
                )}
              </div>
            ) : data.last_reached === 'checkout_success' ? (
              <div className="rounded-md border bg-emerald-50/60 p-3 text-sm">✅ 已完成全部漏斗。</div>
            ) : (
              <div className="rounded-md border bg-muted/50 p-3 text-sm text-foreground/60">未偵測到明顯卡關（資料不足）。</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

