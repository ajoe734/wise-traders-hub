import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  classifyVisitors, identityMap, pageStats, reconcile, sessionize, sourceQuality, isPageView,
  type EventRow, type VisitRow, type Tier,
} from '@/lib/analytics/trafficQuality';

const PageTrendDrawer = lazy(() => import('@/pages/_companyTraffic/PageTrendDrawer'));
const HorizontalBar = lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.HorizontalBar })));
/** 收集方式修正上線日（台北）。此日前的看頁紀錄、登入身分有遺漏。 */
export const METRICS_FIX_DATE = '2026-10-20';
const TIER_LABEL: Record<Tier, string> = { human: '真人', bot: '疑似機器', test: '測試', staff: '自家人' };

async function readPages<T>(q: (o: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let o = 0; ; o += 1000) {
    const { data, error } = await q(o);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

export function useTrafficRaw(from: Date, to: Date) {
  return useQuery({
    queryKey: ['traffic-raw', from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const [visits, events, admins, experts] = await Promise.all([
        readPages<VisitRow>(o => supabase.from('traffic_visits').select('visitor_id,user_id,first_landing_path,first_referrer_host,utm_campaign,utm_content,channel,first_seen_at').gte('first_seen_at', from.toISOString()).lt('first_seen_at', to.toISOString()).order('id').range(o, o + 999)),
        readPages<EventRow>(o => supabase.from('traffic_events').select('visitor_id,user_id,route,event_name,occurred_at,is_internal').gte('occurred_at', from.toISOString()).lt('occurred_at', to.toISOString()).eq('is_internal', false).order('id').range(o, o + 999)),
        supabase.from('user_roles').select('user_id').eq('role', 'company_admin'),
        supabase.from('experts').select('user_id'),
      ]);
      const staff = new Set<string>([...(admins.data ?? []), ...(experts.data ?? [])].map((r: { user_id: string | null }) => r.user_id).filter(Boolean) as string[]);
      return { visits, events, staff };
    },
  });
}

export default function TrafficQuality({ from, to }: { from: Date; to: Date }) {
  const { data, isLoading, error, refetch } = useTrafficRaw(from, to);
  const [showAll, setShowAll] = useState(false);
  const [drill, setDrill] = useState<string | null>(null);
  const [trendPath, setTrendPath] = useState<string | null>(null);

  const calc = useMemo(() => {
    if (!data) return null;
    const cls = classifyVisitors(data.visits, data.events, data.staff);
    const keep = (vid: string) => showAll || (cls.get(vid)?.tier ?? 'human') === 'human';
    const visits = data.visits.filter(v => keep(v.visitor_id));
    const events = data.events.filter(e => keep(e.visitor_id));
    const ids = identityMap(data.visits, data.events);
    const pages = pageStats(events, ids);
    const pvVisitors = new Set(events.filter(isPageView).map(e => e.visitor_id));
    const landed = visits.length;
    const landedWithPv = visits.filter(v => pvVisitors.has(v.visitor_id)).length;
    const sessions = sessionize(events);
    const tiers = { human: 0, bot: 0, test: 0, staff: 0 } as Record<Tier, number>;
    cls.forEach(c => { tiers[c.tier] += 1; });
    const people = new Set(visits.map(v => ids.get(v.visitor_id))).size;
    return {
      cls, pages, tiers, people, sessions, ids,
      sources: sourceQuality(visits, events),
      alerts: reconcile(pages.slice(0, 30), landed, landedWithPv).alerts,
      landed, events,
    };
  }, [data, showAll]);

  if (isLoading) return <p role="status" className="py-6 text-sm text-muted-foreground">載入中…</p>;
  if (error || !calc) return <div role="alert" className="py-6 text-sm text-destructive">流量明細讀取失敗。<Button variant="outline" size="sm" onClick={() => void refetch()}>重試</Button></div>;

  const avgPages = calc.sessions.length ? calc.sessions.reduce((a, s) => a + s.pages, 0) / calc.sessions.length : 0;
  const avgMin = calc.sessions.length ? calc.sessions.reduce((a, s) => a + s.durationMs, 0) / calc.sessions.length / 60000 : 0;
  const drillRows = drill ? calc.events.filter(e => e.route === drill) : [];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">分級：{(['human', 'bot', 'test', 'staff'] as Tier[]).map(t => `${TIER_LABEL[t]} ${calc.tiers[t]}`).join('・')}（不刪資料，僅標記）</p>
      <div className="flex items-center gap-2"><Switch id="q-all" checked={showAll} onCheckedChange={setShowAll} /><Label htmlFor="q-all" className="text-xs">含疑似機器／測試／自家人</Label></div>
    </div>

    {calc.alerts.length > 0 && <Card className="border-destructive"><CardHeader><CardTitle className="text-base text-destructive">對帳警示（差距超過 20%）</CardTitle></CardHeader>
      <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{calc.alerts.map(a => <li key={a}>{a}</li>)}</ul>
        <p className="mt-2 text-xs text-muted-foreground">{METRICS_FIX_DATE.replace(/-/g, '/')} 前的資料因收集方式漏記看頁與登入身分，差距屬已知問題。</p></CardContent></Card>}

    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[['不重複人數（跨裝置合併）', calc.people], ['來訪次數', calc.sessions.length], ['每次來訪頁數', avgPages.toFixed(1)], ['每次停留（分）', avgMin.toFixed(1)]].map(([k, v]) =>
        <Card key={k as string}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-bold">{v}</p></CardContent></Card>)}
    </div>

    <Card><CardHeader><CardTitle className="text-base">熱門頁面（依看頁人數）</CardTitle>
      <p className="text-xs text-muted-foreground">口徑：只算真正打開這頁的人；「有動作」包含按鈕、區塊曝光等其他紀錄。點長條或路徑可看每日折線圖；「原始紀錄」看明細。</p></CardHeader>
      <CardContent className="space-y-4">
        {calc.pages.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">尚無資料</p> :
          <Suspense fallback={<div className="h-[400px]" />}><HorizontalBar data={calc.pages.slice(0, 15).map(p => ({ name: p.path, value: p.viewers }))} onBarClick={setTrendPath} /></Suspense>}
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>路徑</TableHead><TableHead className="text-right">看頁人數</TableHead><TableHead className="text-right">看頁次數</TableHead><TableHead className="text-right">有動作人數</TableHead><TableHead className="text-right">登入會員</TableHead></TableRow></TableHeader>
          <TableBody>{calc.pages.slice(0, 50).map(p => <TableRow key={p.path}>
            <TableCell className="font-mono text-xs"><button type="button" className="underline-offset-2 hover:underline" onClick={() => setTrendPath(p.path)}>{p.path}</button>
              <button type="button" className="ml-2 text-muted-foreground underline-offset-2 hover:underline" onClick={() => setDrill(drill === p.path ? null : p.path)}>原始紀錄</button></TableCell>
            <TableCell className="text-right">{p.viewers}</TableCell><TableCell className="text-right">{p.pageViews}</TableCell><TableCell className="text-right">{p.anyEventVisitors}</TableCell><TableCell className="text-right">{p.loggedInViewers}</TableCell></TableRow>)}</TableBody></Table></div>
        {trendPath && <Suspense fallback={null}><PageTrendDrawer path={trendPath} stat={calc.pages.find(p => p.path === trendPath)} events={calc.events} ids={calc.ids} from={from} to={to} onClose={() => setTrendPath(null)} /></Suspense>}
        {drill && <div aria-label="明細" className="rounded-md border p-3"><p className="mb-2 text-sm font-bold">{drill} 原始紀錄（{drillRows.length} 筆）</p>
          <div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>時間</TableHead><TableHead>訪客</TableHead><TableHead>紀錄</TableHead><TableHead>分級</TableHead></TableRow></TableHeader>
            <TableBody>{drillRows.slice(0, 300).map((e, i) => <TableRow key={i}><TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</TableCell>
              <TableCell className="font-mono text-xs">{e.visitor_id.slice(0, 8)}{e.user_id ? '（會員）' : ''}</TableCell><TableCell className="text-xs">{e.event_name ?? 'page_view'}</TableCell>
              <TableCell className="text-xs">{TIER_LABEL[calc.cls.get(e.visitor_id)?.tier ?? 'human']}{calc.cls.get(e.visitor_id)?.reason ? `：${calc.cls.get(e.visitor_id)?.reason}` : ''}</TableCell></TableRow>)}</TableBody></Table></div></div>}
      </CardContent></Card>

    <Card><CardHeader><CardTitle className="text-base">來源品質</CardTitle><p className="text-xs text-muted-foreground">有後續＝看 2 頁以上，或點方案、訂閱、註冊、結帳。</p></CardHeader>
      <CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>來源</TableHead><TableHead className="text-right">進站</TableHead><TableHead className="text-right">有後續</TableHead><TableHead className="text-right">看 1 頁就走</TableHead><TableHead className="text-right">無看頁紀錄</TableHead></TableRow></TableHeader>
        <TableBody>{calc.sources.map(s => <TableRow key={s.source}><TableCell className="font-medium">{s.source}</TableCell><TableCell className="text-right">{s.visitors}</TableCell>
          <TableCell className="text-right">{s.engaged}（{s.visitors ? Math.round(s.engaged / s.visitors * 100) : 0}%）</TableCell><TableCell className="text-right">{s.bounced}</TableCell><TableCell className="text-right">{s.noPageView}</TableCell></TableRow>)}
          {calc.sources.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">尚無資料</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
  </div>;
}
