import { SEO } from '@/components/SEO';
import { useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, TrendingDown, TrendingUp, Activity, Gauge } from 'lucide-react';
import { useState } from 'react';
import {
import { functionUrl } from "@/lib/supabaseEndpoint";
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend as RcLegend, PieChart, Pie, Cell,
} from 'recharts';

type VariantStat = {
  variant: string;
  attempts: number;
  non_null: number;
  non_null_rate: number;
  adopted: number;
  accepted_after_adoption: number;
  adoption_success_rate: number;
  adoption_share: number;
  avg_latency_ms: number;
};
type ModeStat = { mode: string; entries: number; accepted: number; mismatch: number; empty: number; accept_rate: number };
type ConsensusStat = { consensus: string; count: number; share: number };
type DailyTrend = { date: string; exhausted: number; success: number; total: number; exhausted_rate: number; ocr_entries: number };
type PostOutcomeDaily = { date: string; accepted: number; mismatch: number; empty: number };
type Metrics = {
  range: { from: string; to: string; days: number };
  variantStats: VariantStat[];
  modeStats: ModeStat[];
  consensusStats: ConsensusStat[];
  dailyTrend: DailyTrend[];
  postOutcomeDaily: PostOutcomeDaily[];
  totals: { log_rows: number; total_ocr_entries: number; total_exhausted: number; total_success: number };
  trend_delta: { first_half_rate: number; second_half_rate: number; change: number };
  generated_at: string;
};

const VARIANT_COLORS: Record<string, string> = {
  raw: '#94A3B8',
  otsu: '#0F766E',
  adaptive: '#2563EB',
  dilate: '#D97706',
  loose_crop: '#7C3AED',
};
const CONSENSUS_COLORS: Record<string, string> = {
  majority: '#059669',
  fallback_first: '#D97706',
  none: '#B23A48',
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDate = (s: string | null) => s ? s.slice(5).replace('-', '/') : '—';
const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function BsrOcrMetricsPage() {
  const [days, setDays] = useState(14);
  const [stockInput, setStockInput] = useState('');
  const [stockFilter, setStockFilter] = useState('');

  const { data, isFetching, refetch } = useQuery<Metrics>({
    queryKey: ['bsr-ocr-metrics', days, stockFilter],
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('days', String(days));
      if (stockFilter) qs.set('stock_id', stockFilter);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(
        `${functionUrl("tw-bsr-ocr-metrics")}?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const trendChange = data?.trend_delta.change ?? 0;
  const trendDown = trendChange < -0.001;
  const trendUp = trendChange > 0.001;

  const consensusData = useMemo(() => (data?.consensusStats || []).filter((c) => c.count > 0), [data]);

  return (
    <CompanyLayout>
      <SEO title="BSR OCR 指標面板｜Legendflow 後台" description="captcha 預處理各變體採用率、成功率與 captcha_retry_exhausted 下降趨勢" />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-medium tracking-tight text-foreground">BSR OCR 指標面板</h1>
            <p className="text-[13px] text-foreground/60 mt-1">
              追蹤 captcha 預處理各變體採用率、TWSE accepted 率與 captcha_retry_exhausted 趨勢；資料範圍 {fmtDate(data?.range.from ?? null)} – {fmtDate(data?.range.to ?? null)}
              {data?.generated_at && <span className="ml-2">· 產生於 {fmtDateTime(data.generated_at)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="stock_id (可留空)"
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setStockFilter(stockInput.trim()); }}
              className="h-8 w-32 text-[12px]"
            />
            <Button variant="outline" size="sm" onClick={() => setStockFilter(stockInput.trim())}>套用</Button>
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-[100px] text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[7, 14, 30, 60, 90].map((d) => (<SelectItem key={d} value={String(d)}>{d} 天</SelectItem>))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />重新整理
            </Button>
          </div>
        </div>

        {/* KPI 卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-foreground/60">OCR 進行次數</div>
              <div className="text-[22px] font-medium mt-1">{data?.totals.total_ocr_entries ?? 0}</div>
              <div className="text-[11px] text-foreground/50 mt-1">{data?.totals.log_rows ?? 0} 筆 attempt log</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-foreground/60">captcha_retry_exhausted</div>
              <div className="text-[22px] font-medium mt-1 text-[#B23A48]">{data?.totals.total_exhausted ?? 0}</div>
              <div className="text-[11px] text-foreground/50 mt-1">近 {days} 天累計</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-foreground/60">趨勢變化 (前半 → 後半)</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-[22px] font-medium">
                  {pct(data?.trend_delta.first_half_rate ?? 0)} → {pct(data?.trend_delta.second_half_rate ?? 0)}
                </span>
              </div>
              <div className={`text-[11px] mt-1 flex items-center gap-1 ${trendDown ? 'text-[#059669]' : trendUp ? 'text-[#B23A48]' : 'text-foreground/50'}`}>
                {trendDown ? <TrendingDown className="h-3 w-3" /> : trendUp ? <TrendingUp className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                {trendChange >= 0 ? '+' : ''}{(trendChange * 100).toFixed(2)} pp
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-foreground/60">成功抓取檔次</div>
              <div className="text-[22px] font-medium mt-1 text-[#059669]">{data?.totals.total_success ?? 0}</div>
              <div className="text-[11px] text-foreground/50 mt-1">tw_bsr_daily 命中</div>
            </CardContent>
          </Card>
        </div>

        {/* captcha_retry_exhausted 趨勢 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] font-medium flex items-center gap-2">
              <Gauge className="h-4 w-4" /> captcha_retry_exhausted 下降趨勢
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.dailyTrend || []} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 'auto']} />
                  <Tooltip
                    formatter={(v: any, name: any) => name === 'exhausted_rate' ? pct(v as number) : v}
                    labelFormatter={fmtDate}
                  />
                  <RcLegend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="l" type="monotone" dataKey="exhausted" stroke="#B23A48" strokeWidth={2} dot={false} name="exhausted 次數" />
                  <Line yAxisId="r" type="monotone" dataKey="exhausted_rate" stroke="#D97706" strokeWidth={2} dot={false} name="exhausted 率" />
                  <Line yAxisId="l" type="monotone" dataKey="ocr_entries" stroke="#2563EB" strokeWidth={1} strokeDasharray="4 4" dot={false} name="OCR entries" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 變體採用率 + accepted 率 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px] font-medium">變體採用後 TWSE accepted 率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.variantStats || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                    <XAxis dataKey="variant" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
                    <Tooltip formatter={(v: any) => pct(v as number)} />
                    <Bar dataKey="adoption_success_rate" name="accepted 率">
                      {(data?.variantStats || []).map((v) => (
                        <Cell key={v.variant} fill={VARIANT_COLORS[v.variant] || '#4B5563'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px] font-medium">變體採用份額 (adopted)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.variantStats || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                    <XAxis dataKey="variant" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <RcLegend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="adopted" name="被採用次數" fill="#0F766E" />
                    <Bar dataKey="accepted_after_adoption" name="其中 accepted" fill="#059669" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 變體明細表 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] font-medium">變體明細</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-foreground/60 border-b border-border">
                    <th className="py-2 pr-3">variant</th>
                    <th className="py-2 pr-3 text-right">attempts</th>
                    <th className="py-2 pr-3 text-right">非空猜測率</th>
                    <th className="py-2 pr-3 text-right">被採用</th>
                    <th className="py-2 pr-3 text-right">accepted 率</th>
                    <th className="py-2 pr-3 text-right">採用份額</th>
                    <th className="py-2 pr-3 text-right">avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.variantStats || []).map((v) => (
                    <tr key={v.variant} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: VARIANT_COLORS[v.variant] || '#4B5563' }} />
                          {v.variant}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{v.attempts}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(v.non_null_rate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{v.adopted}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(v.adoption_success_rate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(v.adoption_share)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{v.avg_latency_ms} ms</td>
                    </tr>
                  ))}
                  {(!data?.variantStats?.length) && (
                    <tr><td colSpan={7} className="py-6 text-center text-foreground/50">尚無 OCR trace 資料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* mode / consensus */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px] font-medium">OCR mode 表現</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.modeStats || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                    <XAxis dataKey="mode" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <RcLegend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="accepted" stackId="a" fill="#059669" name="accepted" />
                    <Bar dataKey="mismatch" stackId="a" fill="#D97706" name="mismatch" />
                    <Bar dataKey="empty" stackId="a" fill="#94A3B8" name="empty" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(data?.modeStats || []).map((m) => (
                  <Badge key={m.mode} variant="outline" className="text-[11px]">
                    {m.mode}: {pct(m.accept_rate)} ({m.entries})
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px] font-medium">consensus 分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={consensusData} dataKey="count" nameKey="consensus" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.consensus} ${pct(e.share)}`}>
                      {consensusData.map((c) => (
                        <Cell key={c.consensus} fill={CONSENSUS_COLORS[c.consensus] || '#4B5563'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* post_outcome daily */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] font-medium">TWSE post_outcome 逐日堆疊</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.postOutcomeDaily || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={fmtDate} />
                  <RcLegend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="accepted" stackId="p" fill="#059669" name="accepted" />
                  <Bar dataKey="mismatch" stackId="p" fill="#D97706" name="mismatch" />
                  <Bar dataKey="empty" stackId="p" fill="#94A3B8" name="empty" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
