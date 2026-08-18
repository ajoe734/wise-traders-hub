import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, Activity, Gauge, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import {
import { functionUrl } from "@/lib/supabaseEndpoint";
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, CartesianGrid, Legend, LineChart, Line,
} from 'recharts';

type Bucket = {
  attempts: number;
  success: number;
  captcha: number;
  block: number;
  empty: number;
  other_fail: number;
  success_rate: number;
  captcha_rate: number;
  block_rate: number;
  avg_latency_ms: number;
};

type UaRow = Bucket & { ua_label: string; ua_hash: string };
type BackoffRow = Bucket & { bucket: string; range_sec: [number, number | null] };
type ConsecRow = Bucket & { bucket: string };
type DailyRow = Bucket & { date: string };

type Analysis = {
  range: { from: string; to: string; days: number };
  filters: { ua_hash: string | null };
  totals: Bucket;
  byUa: UaRow[];
  byBackoff: BackoffRow[];
  byConsecutive: ConsecRow[];
  daily: DailyRow[];
  generated_at: string;
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function BsrEffectAnalysis() {
  const [days, setDays] = useState(14);
  const [uaFilter, setUaFilter] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery<Analysis>({
    queryKey: ['bsr-effect', days, uaFilter],
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('days', String(days));
      if (uaFilter) qs.set('ua_hash', uaFilter);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `${functionUrl("tw-bsr-effect-analysis")}?${qs.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const uaChart = useMemo(
    () =>
      (data?.byUa || []).slice(0, 12).map((u) => ({
        name: u.ua_label,
        hash: u.ua_hash,
        attempts: u.attempts,
        success_rate_pct: +(u.success_rate * 100).toFixed(1),
        captcha_rate_pct: +(u.captcha_rate * 100).toFixed(1),
        block_rate_pct: +(u.block_rate * 100).toFixed(1),
        avg_latency_ms: u.avg_latency_ms,
      })),
    [data],
  );

  const boChart = useMemo(
    () =>
      (data?.byBackoff || []).map((b) => ({
        bucket: b.bucket,
        attempts: b.attempts,
        success_rate_pct: +(b.success_rate * 100).toFixed(1),
        captcha_rate_pct: +(b.captcha_rate * 100).toFixed(1),
      })),
    [data],
  );

  const csChart = useMemo(
    () =>
      (data?.byConsecutive || []).map((b) => ({
        bucket: b.bucket,
        attempts: b.attempts,
        success_rate_pct: +(b.success_rate * 100).toFixed(1),
        captcha_rate_pct: +(b.captcha_rate * 100).toFixed(1),
      })),
    [data],
  );

  const daily = useMemo(
    () =>
      (data?.daily || []).map((d) => ({
        date: d.date.slice(5).replace('-', '/'),
        success_rate_pct: +(d.success_rate * 100).toFixed(1),
        captcha_rate_pct: +(d.captcha_rate * 100).toFixed(1),
        attempts: d.attempts,
      })),
    [data],
  );

  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [
      ['section', 'bucket', 'attempts', 'success', 'captcha', 'block', 'empty', 'other_fail', 'success_rate', 'captcha_rate', 'block_rate', 'avg_latency_ms'],
    ];
    data.byUa.forEach((u) =>
      rows.push(['ua', `${u.ua_label} (${u.ua_hash})`, u.attempts, u.success, u.captcha, u.block, u.empty, u.other_fail, u.success_rate, u.captcha_rate, u.block_rate, u.avg_latency_ms]),
    );
    data.byBackoff.forEach((b) =>
      rows.push(['backoff', b.bucket, b.attempts, b.success, b.captcha, b.block, b.empty, b.other_fail, b.success_rate, b.captcha_rate, b.block_rate, b.avg_latency_ms]),
    );
    data.byConsecutive.forEach((b) =>
      rows.push(['consecutive', b.bucket, b.attempts, b.success, b.captcha, b.block, b.empty, b.other_fail, b.success_rate, b.captcha_rate, b.block_rate, b.avg_latency_ms]),
    );
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bsr-effect-${data.range.from}_${data.range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('已匯出 CSV');
  };

  return (
    <CompanyLayout>
      <SEO title="BSR 效果分析 · legendflow" description="UA 池與 backoff 對成功率的影響分析" />
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#292520]">BSR 效果分析</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              比較不同 UA 組合、backoff 秒數與連續失敗次數對抓取成功率的影響。
              {data?.range && (
                <span className="ml-2 text-xs text-muted-foreground/80">
                  {data.range.from.replace(/-/g, '/')} — {data.range.to.replace(/-/g, '/')}（{data.range.days} 天）
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[3, 7, 14, 30, 60, 90].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} 天</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="過濾 UA hash"
              value={uaFilter}
              onChange={(e) => setUaFilter(e.target.value.trim())}
              className="w-[160px]"
            />
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />重新整理
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
              <Download className="h-4 w-4 mr-1" />匯出 CSV
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">{(error as Error).message}</CardContent>
          </Card>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="總嘗試" value={data?.totals.attempts ?? 0} />
          <Kpi label="成功率" value={pct(data?.totals.success_rate ?? 0)} tone="pos" />
          <Kpi label="CAPTCHA 率" value={pct(data?.totals.captcha_rate ?? 0)} tone="warn" />
          <Kpi label="Block 率" value={pct(data?.totals.block_rate ?? 0)} tone="neg" />
          <Kpi label="平均延遲" value={`${data?.totals.avg_latency_ms ?? 0} ms`} />
        </div>

        {/* UA 池成功率 */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base font-semibold text-[#292520]">UA 組合成功率（Top 12）</CardTitle>
            <Badge variant="secondary" className="ml-2 text-xs">{data?.byUa.length ?? 0} 組</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              <ResponsiveContainer>
                <BarChart data={uaChart} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} height={50} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="success_rate_pct" name="成功率 %" fill="#16a34a" />
                  <Bar yAxisId="left" dataKey="captcha_rate_pct" name="CAPTCHA %" fill="#f59e0b" />
                  <Bar yAxisId="left" dataKey="block_rate_pct" name="Block %" fill="#dc2626" />
                  <Bar yAxisId="right" dataKey="attempts" name="嘗試次數" fill="#94a3b8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <UaTable rows={data?.byUa || []} onFilter={setUaFilter} activeHash={uaFilter} />
          </CardContent>
        </Card>

        {/* Backoff 分桶 */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base font-semibold text-[#292520]">Backoff 秒數 vs 成功率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer>
                  <BarChart data={boChart} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="success_rate_pct" name="成功率 %" fill="#16a34a">
                      <LabelList dataKey="success_rate_pct" position="top" style={{ fontSize: 10 }} />
                    </Bar>
                    <Bar yAxisId="left" dataKey="captcha_rate_pct" name="CAPTCHA %" fill="#f59e0b" />
                    <Bar yAxisId="right" dataKey="attempts" name="嘗試次數" fill="#94a3b8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                桶區間 = 嘗試前 backoff_seconds；例如「301-900」表示這次抓取前系統已排定 5–15 分鐘後才重試。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base font-semibold text-[#292520]">連續失敗次數 vs 成功率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer>
                  <BarChart data={csChart} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="success_rate_pct" name="成功率 %" fill="#16a34a">
                      <LabelList dataKey="success_rate_pct" position="top" style={{ fontSize: 10 }} />
                    </Bar>
                    <Bar yAxisId="left" dataKey="captcha_rate_pct" name="CAPTCHA %" fill="#f59e0b" />
                    <Bar yAxisId="right" dataKey="attempts" name="嘗試次數" fill="#94a3b8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                「5+」表示嘗試前已連續失敗五次以上。可看出連續失敗到何種深度後成功率仍未回升，作為 backoff 上限調整依據。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Daily trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-[#292520]">每日成功率 / CAPTCHA 率趨勢</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer>
                <LineChart data={daily} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left" type="monotone" dataKey="success_rate_pct" name="成功率 %" stroke="#16a34a" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="captcha_rate_pct" name="CAPTCHA %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="attempts" name="嘗試次數" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {isLoading && <p className="text-sm text-muted-foreground">載入中…</p>}
        {!isLoading && !data?.totals.attempts && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">此區間尚無嘗試紀錄。等待下輪抓取後即會累積資料。</CardContent></Card>
        )}
      </div>
    </CompanyLayout>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'pos' | 'neg' | 'warn' }) {
  const color = tone === 'pos' ? 'text-emerald-600' : tone === 'neg' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-[#292520]';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function UaTable({ rows, onFilter, activeHash }: { rows: UaRow[]; onFilter: (h: string) => void; activeHash: string }) {
  if (!rows.length) return null;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="p-2 text-left">UA</th>
            <th className="p-2 text-left">Hash</th>
            <th className="p-2 text-right">嘗試</th>
            <th className="p-2 text-right">成功率</th>
            <th className="p-2 text-right">CAPTCHA</th>
            <th className="p-2 text-right">Block</th>
            <th className="p-2 text-right">平均延遲</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.ua_hash} className={`border-b hover:bg-muted/40 ${activeHash === u.ua_hash ? 'bg-primary/5' : ''}`}>
              <td className="p-2 font-medium text-[#292520]">{u.ua_label}</td>
              <td className="p-2 font-mono text-xs text-muted-foreground">{u.ua_hash}</td>
              <td className="p-2 text-right">{u.attempts}</td>
              <td className="p-2 text-right text-emerald-600">{pct(u.success_rate)}</td>
              <td className="p-2 text-right text-amber-600">{pct(u.captcha_rate)}</td>
              <td className="p-2 text-right text-red-600">{pct(u.block_rate)}</td>
              <td className="p-2 text-right">{u.avg_latency_ms} ms</td>
              <td className="p-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => onFilter(activeHash === u.ua_hash ? '' : u.ua_hash)}>
                  {activeHash === u.ua_hash ? '取消' : '篩選'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
