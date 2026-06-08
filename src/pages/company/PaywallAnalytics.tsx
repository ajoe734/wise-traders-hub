import { SEO } from '@/components/SEO';
import { useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, ArrowRight } from 'lucide-react';

// W4-4 Paywall analytics — 完整漏斗：view → hit_limit → click_upgrade → checkout → 成功訂閱

interface PaywallRow {
  user_id: string | null;
  visitor_id: string | null;
  surface: string;
  variant: string | null;
  event_kind: string;
}

const SINCE_DAYS = 30;

export default function PaywallAnalytics() {
  const sinceIso = useMemo(() => new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString(), []);

  const { data: events, isFetching: loadingEvents, refetch: refetchEvents } = useQuery({
    queryKey: ['paywall-events', SINCE_DAYS],
    queryFn: async (): Promise<PaywallRow[]> => {
      const { data, error } = await supabase
        .from('paywall_events')
        .select('user_id, visitor_id, surface, variant, event_kind')
        .gte('created_at', sinceIso)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as PaywallRow[];
    },
    staleTime: 60_000,
  });

  // Set of unique paywall actors (user_id 或 visitor_id) at each stage
  const stageActors = useMemo(() => {
    const make = () => new Set<string>();
    const stages = { view: make(), hit_limit: make(), click_upgrade: make() };
    const userIds = new Set<string>();
    for (const r of events ?? []) {
      const key = r.user_id || (r.visitor_id ? `v:${r.visitor_id}` : null);
      if (!key) continue;
      if (r.user_id) userIds.add(r.user_id);
      if (r.event_kind === 'view') stages.view.add(key);
      else if (r.event_kind === 'hit_limit') stages.hit_limit.add(key);
      else if (r.event_kind === 'click_upgrade') stages.click_upgrade.add(key);
    }
    return { stages, userIds: Array.from(userIds) };
  }, [events]);

  // Checkout 與成功訂閱 — 只計算「曾在 paywall 漏斗中出現過」的 user_id
  const { data: downstream, isFetching: loadingDown, refetch: refetchDown } = useQuery({
    queryKey: ['paywall-downstream', stageActors.userIds.length, sinceIso],
    enabled: stageActors.userIds.length > 0,
    queryFn: async () => {
      const ids = stageActors.userIds;
      const [{ data: intents, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
        supabase
          .from('payment_intents')
          .select('user_id, status')
          .gte('created_at', sinceIso)
          .in('user_id', ids),
        supabase
          .from('member_subscriptions')
          .select('user_id, status, started_at')
          .gte('started_at', sinceIso)
          .in('user_id', ids),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const checkoutUsers = new Set<string>();
      for (const row of intents ?? []) row.user_id && checkoutUsers.add(row.user_id);
      const subscribedUsers = new Set<string>();
      for (const row of subs ?? []) {
        if (row.user_id && (row.status === 'active' || row.status === 'expired')) {
          subscribedUsers.add(row.user_id);
        }
      }
      return { checkoutUsers, subscribedUsers };
    },
    staleTime: 60_000,
  });

  const funnel = useMemo(() => {
    const view = stageActors.stages.view.size;
    const hit = stageActors.stages.hit_limit.size;
    const click = stageActors.stages.click_upgrade.size;
    const checkout = downstream?.checkoutUsers.size ?? 0;
    const subscribed = downstream?.subscribedUsers.size ?? 0;
    return [
      { key: 'view', label: 'View 曝光', count: view, prev: null as number | null },
      { key: 'hit_limit', label: 'Hit Limit 觸及上限', count: hit, prev: view },
      { key: 'click_upgrade', label: 'Click Upgrade 點擊升級', count: click, prev: hit },
      { key: 'checkout', label: 'Checkout 進入結帳', count: checkout, prev: click },
      { key: 'subscribed', label: '成功訂閱', count: subscribed, prev: checkout },
    ];
  }, [stageActors, downstream]);

  // Surface × Variant 拆分（原本的表格）
  const summary = useMemo(() => {
    const map = new Map<string, { surface: string; variant: string; view: number; hit_limit: number; click_upgrade: number }>();
    for (const r of events ?? []) {
      const variant = r.variant || '?';
      const key = `${r.surface}|${variant}`;
      if (!map.has(key)) map.set(key, { surface: r.surface, variant, view: 0, hit_limit: 0, click_upgrade: 0 });
      const cur = map.get(key)!;
      if (r.event_kind === 'view') cur.view++;
      else if (r.event_kind === 'hit_limit') cur.hit_limit++;
      else if (r.event_kind === 'click_upgrade') cur.click_upgrade++;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.surface === b.surface ? a.variant.localeCompare(b.variant) : a.surface.localeCompare(b.surface),
    );
  }, [events]);

  const fmtPct = (n: number, d: number | null) => (d && d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
  const overallRate = funnel[0].count > 0 ? funnel[funnel.length - 1].count / funnel[0].count : 0;
  const loading = loadingEvents || loadingDown;

  return (
    <>
      <SEO title="Paywall 轉換分析 | legendflow 後台" description="Paywall 漏斗：曝光、觸限、點擊、結帳、訂閱成功" />
      <CompanyLayout>
        <div className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-medium tracking-tight">Paywall 轉換分析</h1>
              <p className="text-sm text-muted-foreground mt-1">最近 {SINCE_DAYS} 天｜以唯一使用者計算</p>
            </div>
            <button
              onClick={() => { refetchEvents(); refetchDown(); }}
              className="text-xs text-muted-foreground underline"
            >
              重新整理
            </button>
          </div>

          {/* 漏斗 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="w-4 h-4" />
                轉換漏斗
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  整體轉換率（view → 訂閱）：<span className="text-foreground font-medium tabular-nums">{(overallRate * 100).toFixed(2)}%</span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading && <div className="text-sm text-muted-foreground">載入中…</div>}
              {!loading && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  {funnel.map((s, i) => {
                    const stepRate = s.prev === null ? null : fmtPct(s.count, s.prev);
                    const overall = funnel[0].count > 0 ? (s.count / funnel[0].count) * 100 : 0;
                    return (
                      <div key={s.key} className="relative">
                        <div className="border rounded-md p-3 h-full">
                          <div className="text-xs text-muted-foreground">{i + 1}. {s.label}</div>
                          <div className="text-2xl font-medium tabular-nums mt-1">{s.count}</div>
                          <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
                            <span>上一步轉換</span>
                            <span className="text-foreground tabular-nums">{stepRate ?? '—'}</span>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center justify-between">
                            <span>佔曝光</span>
                            <span className="text-foreground tabular-nums">{funnel[0].count > 0 ? `${overall.toFixed(1)}%` : '—'}</span>
                          </div>
                          {/* 進度條 */}
                          <div className="mt-2 h-1 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${Math.min(overall, 100)}%` }} />
                          </div>
                        </div>
                        {i < funnel.length - 1 && (
                          <ArrowRight className="hidden md:block w-4 h-4 text-muted-foreground absolute -right-3 top-1/2 -translate-y-1/2 z-10" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                註：Checkout 與成功訂閱以「曾出現於 paywall 事件中的 user_id」為母體。匿名訪客（僅 visitor_id）只計入前三步。
              </p>
            </CardContent>
          </Card>

          {/* Surface × Variant 拆分 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Surface × Variant 拆分（事件總數）</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEvents && <div className="text-sm text-muted-foreground">載入中…</div>}
              {!loadingEvents && summary.length === 0 && <div className="text-sm text-muted-foreground">最近 {SINCE_DAYS} 天尚無資料</div>}
              {!loadingEvents && summary.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b text-xs text-muted-foreground">
                        <th className="py-2 pr-4">Surface</th>
                        <th className="py-2 pr-4">Variant</th>
                        <th className="py-2 pr-4 text-right">View</th>
                        <th className="py-2 pr-4 text-right">Hit Limit</th>
                        <th className="py-2 pr-4 text-right">Click</th>
                        <th className="py-2 pr-4 text-right">CTR (click/view)</th>
                        <th className="py-2 text-right">click/hit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((r) => (
                        <tr key={`${r.surface}-${r.variant}`} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{r.surface}</td>
                          <td className="py-2 pr-4"><Badge variant={r.variant === 'A' ? 'secondary' : 'default'}>{r.variant}</Badge></td>
                          <td className="py-2 pr-4 text-right tabular-nums">{r.view}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{r.hit_limit}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{r.click_upgrade}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(r.click_upgrade, r.view)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtPct(r.click_upgrade, r.hit_limit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </CompanyLayout>
    </>
  );
}
