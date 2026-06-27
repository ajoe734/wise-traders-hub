import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { ArrowRight, RefreshCw, Activity, Filter, ExternalLink } from 'lucide-react';

// P1: 統一轉換中心
// 三個 tab：Unified Funnel / Attribution / Cohort Retention
// 並提供使用者層級鑽取（User Journey）入口

type Preset = { id: string; label: string; days: number };
const PRESETS: Preset[] = [
  { id: '7', label: '7 天', days: 7 },
  { id: '14', label: '14 天', days: 14 },
  { id: '30', label: '30 天', days: 30 },
  { id: '60', label: '60 天', days: 60 },
];

const FUNNEL_STEPS = [
  { key: 'page_view', label: '到站', events: ['page_view'] },
  { key: 'pricing_view', label: '瀏覽方案', events: ['pricing_view'] },
  { key: 'checkout_open', label: '進入結帳', events: ['checkout_open', 'checkout_submit'] },
  { key: 'checkout_submit', label: '送出付款', events: ['checkout_submit'] },
  { key: 'checkout_success', label: '完成購買', events: ['checkout_success'] },
] as const;

interface TrafficRow { event_name: string | null; visitor_id: string; user_id: string | null; occurred_at: string }
interface ConversionRow {
  id: string;
  user_id: string | null;
  visitor_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  channel: string | null;
  gross_amount: number | null;
  occurred_at: string;
}
interface SubRow { user_id: string; created_at: string; expires_at: string | null; canceled_at: string | null; status: string | null }

export default function ConversionCenter() {
  const [presetId, setPresetId] = useState('14');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[1];
  const sinceIso = useMemo(() => new Date(Date.now() - preset.days * 86400_000).toISOString(), [preset]);

  // ---- Unified Funnel ----
  const allEvents = useMemo(() => Array.from(new Set(FUNNEL_STEPS.flatMap((s) => s.events))), []);
  const { data: traffic = [], isFetching: loadingT, refetch: refetchT } = useQuery({
    queryKey: ['cc-funnel', presetId],
    queryFn: async (): Promise<TrafficRow[]> => {
      const { data, error } = await supabase
        .from('traffic_events')
        .select('event_name,visitor_id,user_id,occurred_at')
        .in('event_name', allEvents)
        .gte('occurred_at', sinceIso)
        .order('occurred_at', { ascending: true })
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as TrafficRow[];
    },
  });

  const funnelStats = useMemo(() => {
    return FUNNEL_STEPS.map((step) => {
      const matched = traffic.filter((r) => r.event_name && step.events.includes(r.event_name));
      const visitors = new Set(matched.map((r) => r.visitor_id)).size;
      const events = matched.length;
      return { key: step.key, label: step.label, visitors, events };
    });
  }, [traffic]);

  // ---- Attribution ----
  const { data: conversions = [], isFetching: loadingC, refetch: refetchC } = useQuery({
    queryKey: ['cc-conv', presetId],
    queryFn: async (): Promise<ConversionRow[]> => {
      const { data, error } = await supabase
        .from('conversions')
        .select('id,user_id,visitor_id,utm_source,utm_medium,utm_campaign,channel,gross_amount,occurred_at')
        .gte('occurred_at', sinceIso)
        .order('occurred_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as ConversionRow[];
    },
  });

  const attribution = useMemo(() => {
    const buckets = new Map<string, { count: number; gross: number; medium: Set<string>; campaigns: Set<string> }>();
    for (const c of conversions) {
      const key = (c.utm_source || c.channel || '(direct)').slice(0, 40);
      const b = buckets.get(key) ?? { count: 0, gross: 0, medium: new Set(), campaigns: new Set() };
      b.count += 1;
      b.gross += c.gross_amount ?? 0;
      if (c.utm_medium) b.medium.add(c.utm_medium);
      if (c.utm_campaign) b.campaigns.add(c.utm_campaign);
      buckets.set(key, b);
    }
    return Array.from(buckets.entries())
      .map(([source, v]) => ({ source, count: v.count, gross: v.gross, mediums: Array.from(v.medium), campaigns: Array.from(v.campaigns) }))
      .sort((a, b) => b.gross - a.gross);
  }, [conversions]);

  // ---- Cohort retention (weekly) ----
  const cohortStartIso = useMemo(() => new Date(Date.now() - 84 * 86400_000).toISOString(), []); // 12 週
  const { data: subs = [], isFetching: loadingS, refetch: refetchS } = useQuery({
    queryKey: ['cc-cohort'],
    queryFn: async (): Promise<SubRow[]> => {
      const { data, error } = await supabase
        .from('member_subscriptions')
        .select('user_id,created_at,expires_at,canceled_at,status')
        .gte('created_at', cohortStartIso)
        .order('created_at', { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as SubRow[];
    },
  });

  const cohorts = useMemo(() => {
    // Bucket by ISO week (Mon start)
    const map = new Map<string, SubRow[]>();
    const weekKey = (d: Date) => {
      const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dow = (tmp.getUTCDay() + 6) % 7; // Mon=0
      tmp.setUTCDate(tmp.getUTCDate() - dow);
      return tmp.toISOString().slice(0, 10);
    };
    for (const s of subs) {
      const k = weekKey(new Date(s.created_at));
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([weekStart, rows]) => {
        const cohortStart = new Date(weekStart + 'T00:00:00Z').getTime();
        const sizeUsers = new Set(rows.map((r) => r.user_id)).size;
        const retainedAt = (weeks: number) => {
          const at = cohortStart + weeks * 7 * 86400_000;
          if (at > Date.now()) return null;
          const retainedUsers = new Set(
            rows.filter((r) => {
              const exp = r.expires_at ? new Date(r.expires_at).getTime() : 0;
              const cancel = r.canceled_at ? new Date(r.canceled_at).getTime() : Infinity;
              return exp > at && cancel > at;
            }).map((r) => r.user_id),
          ).size;
          return retainedUsers;
        };
        return {
          weekStart,
          size: sizeUsers,
          w1: retainedAt(1),
          w2: retainedAt(2),
          w4: retainedAt(4),
          w8: retainedAt(8),
        };
      });
  }, [subs]);

  // ---- Top users by funnel events (drill-down entry) ----
  const topUsers = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of traffic) {
      if (!r.user_id) continue;
      map.set(r.user_id, (map.get(r.user_id) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [traffic]);

  const refetchAll = () => { refetchT(); refetchC(); refetchS(); };
  const loading = loadingT || loadingC || loadingS;

  return (
    <CompanyLayout>
      <SEO title="轉換中心｜後台分析" description="統一漏斗、歸因與留存儀表" />
      <div className="space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">轉換中心 (Conversion Center)</h1>
            <p className="text-sm text-foreground/60 mt-1">統一漏斗、廣告歸因、留存 Cohort 與使用者路徑鑽取</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-muted/40 p-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className={
                    'px-3 py-1 text-xs rounded-full ' +
                    (p.id === presetId ? 'bg-background shadow-sm font-medium' : 'text-foreground/60')
                  }
                >{p.label}</button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={refetchAll} disabled={loading}>
              <RefreshCw className={'w-4 h-4 mr-1 ' + (loading ? 'animate-spin' : '')} />重新整理
            </Button>
          </div>
        </header>

        <Tabs defaultValue="funnel">
          <TabsList>
            <TabsTrigger value="funnel">統一漏斗</TabsTrigger>
            <TabsTrigger value="attribution">廣告歸因</TabsTrigger>
            <TabsTrigger value="cohort">留存 Cohort</TabsTrigger>
            <TabsTrigger value="users">熱門使用者</TabsTrigger>
          </TabsList>

          <TabsContent value="funnel" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> 全站漏斗 — {preset.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  {funnelStats.map((s, i) => {
                    const prev = i > 0 ? funnelStats[i - 1].visitors : null;
                    const conv = prev && prev > 0 ? (s.visitors / prev) * 100 : null;
                    return (
                      <div key={s.key} className="rounded-lg border bg-card p-4">
                        <div className="text-xs text-foreground/60">{s.label}</div>
                        <div className="text-2xl font-semibold mt-1 tabular-nums">{s.visitors.toLocaleString()}</div>
                        <div className="text-[11px] text-foreground/50 mt-1">events: {s.events.toLocaleString()}</div>
                        {conv !== null && (
                          <Badge variant="secondary" className="mt-2 text-[10px]">
                            <ArrowRight className="w-3 h-3 mr-1" />{conv.toFixed(1)}%
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-foreground/50 mt-3">
                  以唯一 visitor 計算；轉換率為相對前一步。資料來源：traffic_events。
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="attribution" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Filter className="w-4 h-4" /> 來源歸因 — {preset.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {attribution.length === 0 ? (
                  <p className="text-sm text-foreground/50">區間內尚無 conversions。</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-foreground/60 border-b">
                        <tr>
                          <th className="text-left py-2 pr-4">Source</th>
                          <th className="text-right py-2 pr-4">轉換數</th>
                          <th className="text-right py-2 pr-4">總金額</th>
                          <th className="text-right py-2 pr-4">客單價</th>
                          <th className="text-left py-2 pr-4">Medium</th>
                          <th className="text-left py-2 pr-4">Campaign</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attribution.map((a) => (
                          <tr key={a.source} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{a.source}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{a.count}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">${a.gross.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-foreground/70">
                              ${a.count ? Math.round(a.gross / a.count).toLocaleString() : 0}
                            </td>
                            <td className="py-2 pr-4 text-xs text-foreground/60">{a.mediums.join(', ') || '—'}</td>
                            <td className="py-2 pr-4 text-xs text-foreground/60">{a.campaigns.slice(0, 2).join(', ') || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cohort" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">每週訂閱 Cohort 留存（過去 12 週）</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-foreground/60 border-b">
                      <tr>
                        <th className="text-left py-2 pr-4">起始週</th>
                        <th className="text-right py-2 pr-4">新訂閱</th>
                        <th className="text-right py-2 pr-4">W+1</th>
                        <th className="text-right py-2 pr-4">W+2</th>
                        <th className="text-right py-2 pr-4">W+4</th>
                        <th className="text-right py-2 pr-4">W+8</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohorts.map((c) => {
                        const cell = (n: number | null) => {
                          if (n === null) return <span className="text-foreground/30">—</span>;
                          const pct = c.size ? Math.round((n / c.size) * 100) : 0;
                          return <span className="tabular-nums">{n} <span className="text-[10px] text-foreground/50">({pct}%)</span></span>;
                        };
                        return (
                          <tr key={c.weekStart} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{c.weekStart}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{c.size}</td>
                            <td className="py-2 pr-4 text-right">{cell(c.w1)}</td>
                            <td className="py-2 pr-4 text-right">{cell(c.w2)}</td>
                            <td className="py-2 pr-4 text-right">{cell(c.w4)}</td>
                            <td className="py-2 pr-4 text-right">{cell(c.w8)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-foreground/50 mt-3">
                  以 member_subscriptions.created_at 分組，留存定義為 expires_at &gt; 該時點且未被取消。
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">活躍使用者 Top 15（{preset.label}）</CardTitle>
              </CardHeader>
              <CardContent>
                {topUsers.length === 0 ? (
                  <p className="text-sm text-foreground/50">區間內無已登入事件。</p>
                ) : (
                  <ul className="divide-y">
                    {topUsers.map(([uid, count]) => (
                      <li key={uid} className="py-2 flex items-center justify-between gap-3">
                        <code className="text-xs text-foreground/70 truncate">{uid}</code>
                        <div className="flex items-center gap-3">
                          <span className="text-xs tabular-nums text-foreground/60">{count} events</span>
                          <Link to={`/company/user-journey/${uid}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                            鑽取路徑 <ExternalLink className="w-3 h-3" />
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </CompanyLayout>
  );
}
