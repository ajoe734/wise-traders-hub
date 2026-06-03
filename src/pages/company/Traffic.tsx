import { lazy, Suspense, useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isInternalTrackingOn, setInternalTracking } from '@/lib/trafficTracker';

const Charts = {
  Sparkline: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.Sparkline }))),
  DailyTrendChart: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.DailyTrendChart }))),
  FunnelWaterfall: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.FunnelWaterfall }))),
  ChannelDonut: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.ChannelDonut }))),
  HorizontalBar: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.HorizontalBar }))),
  ProductStackedBar: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.ProductStackedBar }))),
  RoasScatter: lazy(() => import('@/pages/_companyTraffic/Charts').then(m => ({ default: m.RoasScatter }))),
};
const ChartFallback = ({ h = 240 }: { h?: number }) => (
  <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: h }}>載入圖表…</div>
);

const fmtMoney = (n: number) => `NT$${(n || 0).toLocaleString()}`;
const fmtNum = (n: number) => (n || 0).toLocaleString();
const fmtTs = (s?: string | null) => s ? new Date(s).toLocaleString('zh-TW', { hour12: false }) : '—';
const pct = (curr: number, prev: number): { v: number; up: boolean } | null => {
  if (!prev || prev === 0) return null;
  const v = ((curr - prev) / prev) * 100;
  return { v: Math.round(v * 10) / 10, up: v >= 0 };
};

function getRange(preset: string): { from: Date; to: Date } {
  const now = new Date();
  if (preset === 'this_month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  if (preset === 'last_month') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
  if (preset === 'last_3m') return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: now };
  if (preset === 'last_30d') return { from: new Date(now.getTime() - 30 * 86400000), to: now };
  return { from: new Date(now.getTime() - 7 * 86400000), to: now };
}

interface Overview {
  kpi: { visitors: number; returning_visitors: number; page_views: number; signups: number; orders: number; gross: number; platform: number };
  daily: Array<{ day: string; visitors: number; page_views: number; orders: number; gross: number }>;
  channels: Array<{ channel: string; visitors: number; orders: number; gross: number }>;
  campaigns: Array<{ campaign: string; source: string; medium: string; visitors: number; signups: number; orders: number; gross: number }>;
  referrers: Array<{ host: string; visitors: number }>;
  landings: Array<{ path: string; visitors: number }>;
}

interface AdSpendRow { id: string; utm_campaign: string; yyyymm: string; spend_amount: number; utm_source: string | null; utm_medium: string | null; note: string | null }
interface FunnelStep { step: string; visitors: number; drop_from_prev: number | null }
interface EventRow { event_name: string; total_count: number; unique_visitors: number; unique_users: number; last_seen: string }
interface HealthInfo { visits_total: number; events_total: number; named_events_total: number; last_visit_at: string | null; last_event_at: string | null }
interface ProductRow { product: string; events: number; unique_visitors: number; logged_in_visitors: number }
interface PageRow { path: string; page_views: number; unique_visitors: number; logged_in_visitors: number }
interface InstrumentRow { instrument: string; events: number; unique_visitors: number }
interface JourneyRow { occurred_at: string; route: string; event_name: string | null; event_props: Record<string, unknown> | null; is_internal: boolean }

const DEFAULT_FUNNEL = ['pricing_view', 'expert_profile_view', 'expert_subscribe_click', 'checkout_open', 'checkout_success'];
const FUNNELS: Record<string, string[]> = {
  subscribe: ['pricing_view', 'expert_profile_view', 'expert_subscribe_click', 'checkout_open', 'checkout_success'],
  checkup_to_paid: ['checkup_view', 'checkup_analysis_run', 'checkup_quota_blocked', 'checkup_upgrade_click', 'checkout_success'],
  signals_retention: ['app_dashboard_view', 'signal_view', 'expert_detail_view', 'expert_subscribe_click'],
  holdings_depth: ['app_dashboard_view', 'holdings_dashboard_view', 'holding_card_click', 'signal_view'],
};
const FUNNEL_TITLES: Record<string, string> = {
  subscribe: '訂閱付款',
  checkup_to_paid: '修煉派轉付費',
  signals_retention: '跟單派回訪',
  holdings_depth: '持股看板深度',
};
const FUNNEL_LABEL: Record<string, string> = {
  pricing_view: '訪問定價頁',
  expert_profile_view: '看專家頁',
  expert_subscribe_click: '點訂閱按鈕',
  checkout_open: '進結帳頁',
  checkout_success: '完成付款',
  leaderboard_view: '看戰報榜',
  checkup_view: '進修煉派',
  checkup_analysis_run: '跑分析',
  checkup_quota_blocked: '配額擋住',
  checkup_upgrade_click: '點升級',
  app_dashboard_view: '看跟單派首頁',
  signal_view: '看訊號',
  expert_detail_view: '看專家詳情',
  holdings_dashboard_view: '看持股看板',
  holding_card_click: '點持股卡',
};
const PRODUCT_LABEL: Record<string, string> = {
  checkup: '修煉派',
  signals: '跟單派',
  learning: '學習中心',
};

export default function CompanyTraffic() {
  const [preset, setPreset] = useState('this_month');
  const range = useMemo(() => getRange(preset), [preset]);
  const [internalOn, setInternalOn] = useState(isInternalTrackingOn());

  const prevRange = useMemo(() => {
    const span = range.to.getTime() - range.from.getTime();
    return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
  }, [range]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['traffic-overview', preset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_traffic_overview', {
        _from: range.from.toISOString(),
        _to: range.to.toISOString(),
      });
      if (error) throw error;
      return data as unknown as Overview;
    },
  });

  const { data: prevData } = useQuery({
    queryKey: ['traffic-overview-prev', preset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_traffic_overview', {
        _from: prevRange.from.toISOString(),
        _to: prevRange.to.toISOString(),
      });
      if (error) throw error;
      return data as unknown as Overview;
    },
  });

  const { data: health, refetch: refetchHealth } = useQuery({
    queryKey: ['traffic-health'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_traffic_health');
      if (error) throw error;
      return data as unknown as HealthInfo;
    },
    refetchInterval: 30_000,
  });

  const { data: funnels } = useQuery({
    queryKey: ['traffic-funnels-all', preset],
    queryFn: async () => {
      const out: Record<string, FunnelStep[]> = {};
      for (const key of Object.keys(FUNNELS)) {
        const { data, error } = await supabase.rpc('get_funnel_overview', {
          _from: range.from.toISOString(), _to: range.to.toISOString(), _steps: FUNNELS[key],
        });
        if (error) throw error;
        out[key] = (data || []) as unknown as FunnelStep[];
      }
      return out;
    },
  });

  const { data: heatmap } = useQuery({
    queryKey: ['traffic-heatmap', preset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_event_heatmap', {
        _from: range.from.toISOString(), _to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data || []) as unknown as EventRow[];
    },
  });

  const [showInternal, setShowInternal] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['traffic-products', preset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_product_breakdown', {
        _from: range.from.toISOString(), _to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data || []) as unknown as ProductRow[];
    },
  });

  const { data: pages } = useQuery({
    queryKey: ['traffic-pages', preset, showInternal],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_page_analytics', {
        _from: range.from.toISOString(), _to: range.to.toISOString(), _include_internal: showInternal,
      });
      if (error) throw error;
      return (data || []) as unknown as PageRow[];
    },
  });

  const { data: instruments } = useQuery({
    queryKey: ['traffic-instruments', preset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_top_instruments', {
        _from: range.from.toISOString(), _to: range.to.toISOString(), _limit: 30,
      });
      if (error) throw error;
      return (data || []) as unknown as InstrumentRow[];
    },
  });

  const { data: adSpend, refetch: refetchSpend } = useQuery({
    queryKey: ['ad-spend'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_spend').select('*').order('yyyymm', { ascending: false });
      if (error) throw error;
      return (data || []) as AdSpendRow[];
    },
  });

  const [newSpend, setNewSpend] = useState({ utm_campaign: '', yyyymm: new Date().toISOString().slice(0, 7), spend_amount: 0, utm_source: '', utm_medium: '' });

  async function saveSpend() {
    if (!newSpend.utm_campaign || !newSpend.yyyymm) { toast.error('campaign 與月份必填'); return; }
    const { error } = await supabase.from('ad_spend').upsert(
      { ...newSpend, utm_source: newSpend.utm_source || null, utm_medium: newSpend.utm_medium || null, spend_amount: Number(newSpend.spend_amount) || 0 },
      { onConflict: 'utm_campaign,yyyymm' }
    );
    if (error) { toast.error(error.message); return; }
    toast.success('已儲存');
    refetchSpend();
  }

  async function deleteSpend(id: string) {
    if (!confirm('刪除這筆廣告花費？')) return;
    const { error } = await supabase.from('ad_spend').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    refetchSpend();
  }

  function toggleInternal(v: boolean) {
    setInternalTracking(v);
    setInternalOn(v);
    toast.success(v ? '已開啟 Internal 追蹤（含 /company /admin）— 重新整理頁面後生效' : '已關閉 Internal 追蹤');
  }

  useEffect(() => { setInternalOn(isInternalTrackingOn()); }, []);

  const kpi = data?.kpi;

  return (
    <CompanyLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">流量監控</h1>
            <p className="text-sm text-muted-foreground">流量來源、轉換漏斗、功能熱度、廣告 ROAS 一次看</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="last_7d">近 7 天</SelectItem>
                <SelectItem value="last_30d">近 30 天</SelectItem>
                <SelectItem value="this_month">本月</SelectItem>
                <SelectItem value="last_month">上月</SelectItem>
                <SelectItem value="last_3m">近 3 月</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => { refetch(); refetchHealth(); }}>重新整理</Button>
          </div>
        </div>

        {/* Health banner */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-muted-foreground">資料庫總筆數</span>
              <span><span className="text-muted-foreground">訪客 </span><b>{fmtNum(health?.visits_total || 0)}</b></span>
              <span><span className="text-muted-foreground">頁面事件 </span><b>{fmtNum(health?.events_total || 0)}</b></span>
              <span><span className="text-muted-foreground">具名事件 </span><b>{fmtNum(health?.named_events_total || 0)}</b></span>
              <span className="text-muted-foreground">上次寫入</span>
              <span className="font-mono text-xs">{fmtTs(health?.last_event_at || health?.last_visit_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-internal" checked={showInternal} onCheckedChange={setShowInternal} />
              <Label htmlFor="show-internal" className="text-xs cursor-pointer">在頁面分析顯示 /company /admin 內部流量</Label>
            </div>
          </CardContent>
        </Card>

        {isLoading && <Card><CardContent className="p-6 text-sm text-muted-foreground">載入中…</CardContent></Card>}

        {kpi && (() => {
          const prev = prevData?.kpi;
          const daily = data?.daily || [];
          const spark = (key: 'visitors' | 'page_views' | 'orders' | 'gross') => daily.map(d => Number(d[key]) || 0);
          const cvr = kpi.visitors > 0 ? (kpi.orders / kpi.visitors) * 100 : 0;
          const prevCvr = prev && prev.visitors > 0 ? (prev.orders / prev.visitors) * 100 : 0;
          const arpu = kpi.orders > 0 ? kpi.gross / kpi.orders : 0;
          const prevArpu = prev && prev.orders > 0 ? prev.gross / prev.orders : 0;
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="獨立訪客" value={fmtNum(kpi.visitors)} delta={prev && pct(kpi.visitors, prev.visitors)} spark={spark('visitors')} />
              <Kpi label="瀏覽數" value={fmtNum(kpi.page_views)} delta={prev && pct(kpi.page_views, prev.page_views)} spark={spark('page_views')} />
              <Kpi label="註冊數" value={fmtNum(kpi.signups)} delta={prev && pct(kpi.signups, prev.signups)} />
              <Kpi label="訂單數" value={fmtNum(kpi.orders)} delta={prev && pct(kpi.orders, prev.orders)} spark={spark('orders')} />
              <Kpi label="毛收" value={fmtMoney(kpi.gross)} delta={prev && pct(kpi.gross, prev.gross)} spark={spark('gross')} sparkColor="hsl(var(--mentor))" />
              <Kpi label="平台分潤" value={fmtMoney(kpi.platform)} delta={prev && pct(kpi.platform, prev.platform)} />
              <Kpi label="CVR" value={kpi.visitors > 0 ? `${cvr.toFixed(2)}%` : '—'} delta={prev && pct(cvr, prevCvr)} />
              <Kpi label="ARPU" value={kpi.orders > 0 ? fmtMoney(Math.round(arpu)) : '—'} delta={prev && pct(arpu, prevArpu)} />
            </div>
          );
        })()}

        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">總覽</TabsTrigger>
            <TabsTrigger value="products">產品線</TabsTrigger>
            <TabsTrigger value="funnel">轉換漏斗</TabsTrigger>
            <TabsTrigger value="events">功能熱度</TabsTrigger>
            <TabsTrigger value="pages">頁面分析</TabsTrigger>
            <TabsTrigger value="instruments">熱門個股</TabsTrigger>
            <TabsTrigger value="sources">流量來源</TabsTrigger>
            <TabsTrigger value="campaigns">廣告與營收</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader><CardTitle className="text-base">每日流量與營收</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead className="text-right">訪客</TableHead>
                      <TableHead className="text-right">瀏覽</TableHead>
                      <TableHead className="text-right">訂單</TableHead>
                      <TableHead className="text-right">毛收</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.daily || []).map((d) => (
                      <TableRow key={d.day}>
                        <TableCell>{d.day}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.page_views)}</TableCell>
                        <TableCell className="text-right">{fmtNum(d.orders)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(d.gross)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="products">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">產品線拆解（修煉派 / 跟單派 / 學習中心）</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">依路徑與事件名稱自動分流</p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>產品線</TableHead>
                    <TableHead className="text-right">事件數</TableHead>
                    <TableHead className="text-right">不重複訪客</TableHead>
                    <TableHead className="text-right">登入會員</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(products || []).map((p) => (
                      <TableRow key={p.product}>
                        <TableCell className="font-medium">{PRODUCT_LABEL[p.product] ?? p.product}</TableCell>
                        <TableCell className="text-right">{fmtNum(p.events)}</TableCell>
                        <TableCell className="text-right">{fmtNum(p.unique_visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(p.logged_in_visitors)}</TableCell>
                      </TableRow>
                    ))}
                    {(!products || products.length === 0) && (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">尚無資料</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="funnel" className="space-y-4">
            {Object.keys(FUNNELS).map((key) => {
              const steps = funnels?.[key] || [];
              const start = steps[0]?.visitors || 0;
              return (
                <Card key={key}>
                  <CardHeader>
                    <CardTitle className="text-base">{FUNNEL_TITLES[key]}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">{FUNNELS[key].join(' → ')}</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {steps.map((step, i) => {
                      const widthPct = start > 0 ? Math.max(4, (step.visitors / start) * 100) : 0;
                      return (
                        <div key={step.step} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">{i + 1}. {FUNNEL_LABEL[step.step] ?? step.step}</span>
                            <span className="text-muted-foreground">
                              {fmtNum(step.visitors)} 訪客
                              {step.drop_from_prev != null && <> · drop {step.drop_from_prev}%</>}
                            </span>
                          </div>
                          <div className="h-5 bg-muted rounded">
                            <div className="h-full bg-primary/80 rounded transition-all" style={{ width: `${widthPct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {steps.length === 0 && <p className="text-sm text-muted-foreground">尚無資料</p>}
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">功能事件熱度</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  以 event_name 群組，顯示總次數、不重複訪客、登入會員數、最後發生時間
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>事件</TableHead>
                      <TableHead className="text-right">次數</TableHead>
                      <TableHead className="text-right">不重複訪客</TableHead>
                      <TableHead className="text-right">登入會員</TableHead>
                      <TableHead className="text-right">人均</TableHead>
                      <TableHead>最後發生</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(heatmap || []).map((r) => (
                      <TableRow key={r.event_name}>
                        <TableCell className="font-mono text-xs">{r.event_name}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.total_count)}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.unique_visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.unique_users)}</TableCell>
                        <TableCell className="text-right">{r.unique_visitors > 0 ? (r.total_count / r.unique_visitors).toFixed(1) : '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtTs(r.last_seen)}</TableCell>
                      </TableRow>
                    ))}
                    {(!heatmap || heatmap.length === 0) && (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">尚無具名事件</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pages">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">頁面分析（PV / UV / 登入會員）</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">依路徑彙總；右上方開關控制是否包含 /company /admin 內部流量</p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>路徑</TableHead>
                    <TableHead className="text-right">PV</TableHead>
                    <TableHead className="text-right">UV</TableHead>
                    <TableHead className="text-right">登入會員</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(pages || []).map((p) => (
                      <TableRow key={p.path}>
                        <TableCell className="font-mono text-xs">{p.path}</TableCell>
                        <TableCell className="text-right">{fmtNum(p.page_views)}</TableCell>
                        <TableCell className="text-right">{fmtNum(p.unique_visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(p.logged_in_visitors)}</TableCell>
                      </TableRow>
                    ))}
                    {(!pages || pages.length === 0) && (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">尚無資料</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="instruments">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">熱門個股 Top 30</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">從事件 event_props 的 instrument 欄位聚合（持股看板、訊號、漲停榜）</p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>個股</TableHead>
                    <TableHead className="text-right">事件數</TableHead>
                    <TableHead className="text-right">不重複訪客</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(instruments || []).map((i) => (
                      <TableRow key={i.instrument}>
                        <TableCell className="font-mono text-xs">{i.instrument}</TableCell>
                        <TableCell className="text-right">{fmtNum(i.events)}</TableCell>
                        <TableCell className="text-right">{fmtNum(i.unique_visitors)}</TableCell>
                      </TableRow>
                    ))}
                    {(!instruments || instruments.length === 0) && (
                      <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">尚無個股事件</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sources" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Channel 分布</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead className="text-right">訪客</TableHead><TableHead className="text-right">訂單</TableHead><TableHead className="text-right">毛收</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(data?.channels || []).map((c) => (
                      <TableRow key={c.channel}>
                        <TableCell className="font-medium">{c.channel}</TableCell>
                        <TableCell className="text-right">{fmtNum(c.visitors)}</TableCell>
                        <TableCell className="text-right">{fmtNum(c.orders)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(c.gross)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Top Referrers</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Host</TableHead><TableHead className="text-right">訪客</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(data?.referrers || []).map((r) => (
                        <TableRow key={r.host}><TableCell className="font-mono text-xs">{r.host}</TableCell><TableCell className="text-right">{fmtNum(r.visitors)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Top Landing Pages</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>路徑</TableHead><TableHead className="text-right">訪客</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(data?.landings || []).map((l) => (
                        <TableRow key={l.path}><TableCell className="font-mono text-xs">{l.path}</TableCell><TableCell className="text-right">{fmtNum(l.visitors)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Campaign 轉換營收</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Source / Medium</TableHead>
                      <TableHead className="text-right">訪客</TableHead>
                      <TableHead className="text-right">註冊</TableHead>
                      <TableHead className="text-right">訂單</TableHead>
                      <TableHead className="text-right">毛收</TableHead>
                      <TableHead className="text-right">CVR</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.campaigns || []).map((c) => {
                      const spend = (adSpend || []).filter(s => s.utm_campaign === c.campaign).reduce((a, b) => a + (b.spend_amount || 0), 0);
                      const cvr = c.visitors > 0 ? ((c.orders / c.visitors) * 100).toFixed(2) + '%' : '—';
                      const roas = spend > 0 ? (c.gross / spend).toFixed(2) + 'x' : '—';
                      return (
                        <TableRow key={`${c.campaign}-${c.source}-${c.medium}`}>
                          <TableCell className="font-medium">{c.campaign}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.source} / {c.medium}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.visitors)}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.signups)}</TableCell>
                          <TableCell className="text-right">{fmtNum(c.orders)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(c.gross)}</TableCell>
                          <TableCell className="text-right">{cvr}</TableCell>
                          <TableCell className="text-right">{roas}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">廣告花費（手動輸入，計算 ROAS / CAC）</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Input placeholder="utm_campaign" value={newSpend.utm_campaign} onChange={(e) => setNewSpend(s => ({ ...s, utm_campaign: e.target.value }))} />
                  <Input placeholder="月份 YYYY-MM" value={newSpend.yyyymm} onChange={(e) => setNewSpend(s => ({ ...s, yyyymm: e.target.value }))} />
                  <Input placeholder="utm_source" value={newSpend.utm_source} onChange={(e) => setNewSpend(s => ({ ...s, utm_source: e.target.value }))} />
                  <Input placeholder="utm_medium" value={newSpend.utm_medium} onChange={(e) => setNewSpend(s => ({ ...s, utm_medium: e.target.value }))} />
                  <Input type="number" placeholder="花費 NT$" value={newSpend.spend_amount} onChange={(e) => setNewSpend(s => ({ ...s, spend_amount: Number(e.target.value) }))} />
                  <Button onClick={saveSpend}>儲存 / 覆蓋</Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>月份</TableHead><TableHead>Campaign</TableHead><TableHead>Source/Medium</TableHead>
                      <TableHead className="text-right">花費</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(adSpend || []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.yyyymm}</TableCell>
                        <TableCell>{s.utm_campaign}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.utm_source || '—'} / {s.utm_medium || '—'}</TableCell>
                        <TableCell className="text-right">{fmtMoney(s.spend_amount)}</TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => deleteSpend(s.id)}>刪除</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </CompanyLayout>
  );
}

function Kpi({
  label, value, delta, spark, sparkColor,
}: {
  label: string;
  value: string;
  delta?: { v: number; up: boolean } | null;
  spark?: number[];
  sparkColor?: string;
}) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div className="text-xl font-semibold">{value}</div>
        {delta && (
          <div className={`text-[11px] font-medium ${delta.up ? 'text-[hsl(var(--mentor))]' : 'text-muted-foreground'}`}>
            {delta.up ? '▲' : '▼'} {Math.abs(delta.v)}%
          </div>
        )}
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-2 -mx-1">
          <Suspense fallback={<div style={{ height: 36 }} />}>
            <Charts.Sparkline data={spark} color={sparkColor} />
          </Suspense>
        </div>
      )}
    </CardContent></Card>
  );
}
