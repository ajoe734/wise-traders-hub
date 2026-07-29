import { SEO } from '@/components/SEO';
import { lazy, Suspense, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Gauge, RefreshCw } from 'lucide-react';

const PerfDailyChart = lazy(() =>
  import('@/components/company/PerfMetricsChart').then((m) => ({ default: m.PerfDailyChart }))
);
const PriceParityCard = lazy(() =>
  import('@/components/company/PriceParityCard').then((m) => ({ default: m.PriceParityCard }))
);



interface RouteRow {
  route: string;
  samples: number;
  fcp_p50: number | null;
  fcp_p75: number | null;
  fcp_p95: number | null;
  lcp_p50: number | null;
  lcp_p95: number | null;
  inp_p75: number | null;
  inp_p95: number | null;
  cls_p75: number | null;
}

interface Summary {
  since: string;
  totals: {
    samples: number;
    routes: number;
    fcp_p50: number | null;
    fcp_p95: number | null;
    lcp_p50: number | null;
    lcp_p95: number | null;
    inp_p75: number | null;
    inp_p95: number | null;
    cls_p75: number | null;
    cls_p95: number | null;
  };
  daily: Array<{
    day: string;
    samples: number;
    fcp_p50: number | null;
    fcp_p95: number | null;
    lcp_p50: number | null;
    lcp_p95: number | null;
    inp_p50: number | null;
    inp_p95: number | null;
    cls_p50: number | null;
    cls_p95: number | null;
  }>;
  routes: RouteRow[];
}

const fmtMs = (v: number | null | undefined) => (v == null ? '—' : `${v} ms`);
const fmtCls = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(3);

function tone(v: number | null, good: number, warn: number) {
  if (v == null) return 'text-foreground/50';
  if (v <= good) return 'text-success';
  if (v <= warn) return 'text-warning';
  return 'text-destructive';
}

export default function PerfMetricsPage() {
  const [days, setDays] = useState(7);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company', 'perf-metrics', days],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_perf_metrics_summary', { _days: days });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const totals = data?.totals;

  return (
    <CompanyLayout>
      <SEO title={'前端效能 | legendflow'} description={'前端 FCP/LCP RUM 儀表板。'} path={'/company/perf-metrics'} noindex />
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Gauge className="h-5 w-5" />
          <div>
            <h1 className="text-[18px] font-medium tracking-tight">前台效能指標</h1>
            <p className="text-[12px] text-foreground/55 mt-0.5">真實使用者 FCP / LCP，保留 7 天</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[1, 7].map((d) => (
            <Button
              key={d}
              variant={days === d ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d === 1 ? '今天' : '7 天'}
            </Button>
          ))}
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="樣本數" value={totals?.samples?.toLocaleString() ?? '—'} sub={`${totals?.routes ?? 0} 條路徑`} />
        <SummaryCard label="LCP P50" value={fmtMs(totals?.lcp_p50)} sub="目標 < 2500ms" toneClass={tone(totals?.lcp_p50 ?? null, 2500, 4000)} />
        <SummaryCard label="INP P75" value={fmtMs(totals?.inp_p75)} sub="目標 < 200ms" toneClass={tone(totals?.inp_p75 ?? null, 200, 500)} />
        <SummaryCard
          label="CLS P75"
          value={fmtCls(totals?.cls_p75)}
          sub="目標 < 0.1"
          toneClass={tone(totals?.cls_p75 != null ? totals.cls_p75 * 1000 : null, 100, 250)}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">每日趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[280px] flex items-center justify-center text-foreground/50 text-sm">載入中…</div>
          ) : (data?.daily?.length ?? 0) === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-foreground/50 text-sm">尚無資料</div>
          ) : (
            <Suspense fallback={<div className="h-[280px]" />}>
              <PerfDailyChart data={data!.daily} />
            </Suspense>
          )}
        </CardContent>
      </Card>

      <PriceParityCard days={days} />



      <Card>
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">路徑排行</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-foreground/55 border-b border-foreground/10">
                  <th className="py-2 pr-4">路徑</th>
                  <th className="py-2 pr-4 text-right">樣本</th>
                  <th className="py-2 pr-4 text-right">LCP P50</th>
                  <th className="py-2 pr-4 text-right">LCP P95</th>
                  <th className="py-2 pr-4 text-right">INP P75</th>
                  <th className="py-2 pr-4 text-right">INP P95</th>
                  <th className="py-2 pr-4 text-right">CLS P75</th>
                  <th className="py-2 text-right">FCP P75</th>
                </tr>
              </thead>
              <tbody>
                {(data?.routes ?? []).map((r) => (
                  <tr key={r.route} className="border-b border-foreground/5">
                    <td className="py-2 pr-4 font-mono text-[12px] truncate max-w-[280px]" title={r.route}>{r.route}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      <Badge variant="secondary">{r.samples}</Badge>
                    </td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${tone(r.lcp_p50, 2500, 4000)}`}>{fmtMs(r.lcp_p50)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${tone(r.lcp_p95, 4000, 6000)}`}>{fmtMs(r.lcp_p95)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${tone(r.inp_p75, 200, 500)}`}>{fmtMs(r.inp_p75)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${tone(r.inp_p95, 500, 1000)}`}>{fmtMs(r.inp_p95)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${tone(r.cls_p75 != null ? r.cls_p75 * 1000 : null, 100, 250)}`}>{fmtCls(r.cls_p75)}</td>
                    <td className={`py-2 text-right tabular-nums ${tone(r.fcp_p75, 2200, 3500)}`}>{fmtMs(r.fcp_p75)}</td>
                  </tr>
                ))}
                {!isLoading && (data?.routes?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-foreground/50">尚無資料</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </CompanyLayout>
  );
}

function SummaryCard({ label, value, sub, toneClass }: { label: string; value: string; sub?: string; toneClass?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] text-foreground/55">{label}</div>
        <div className={`text-[22px] font-medium tracking-tight mt-1 tabular-nums ${toneClass ?? ''}`}>{value}</div>
        {sub && <div className="text-[11px] text-foreground/45 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
