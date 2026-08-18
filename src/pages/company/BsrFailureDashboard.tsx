import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, AlertTriangle, ShieldAlert, ChevronRight, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend as RcLegend,
} from 'recharts';
import { BsrAuditDialog } from './BsrAuditDialog';
import { functionUrl } from "@/lib/supabaseEndpoint";

type GlobalDay = {
  date: string;
  attempts: number;
  success: number;
  ocr_fail: number;
  http_block: number;
  empty: number;
  captcha_rate: number;
};

type DailyBreakdown = { date: string; reason: string; error_class: string; attempts: number; resolved: boolean };

type PerStock = {
  stock_id: string;
  name: string | null;
  total_failures: number;
  captcha_retry_exhausted: number;
  other_failures: number;
  latest_target_date: string | null;
  latest_reason: string | null;
  unresolved: number;
  consecutive_failures: number;
  next_retry_at: string | null;
  fallback_as_of_date: string | null;
  fallback_lag_days: number | null;
  dailyBreakdown: DailyBreakdown[];
};

type ClassDist = { error_class: string; count: number; share: number };

type Dashboard = {
  range: { from: string; to: string; days: number };
  globalDaily: GlobalDay[];
  perStock: PerStock[];
  topOffenders: Array<PerStock & { captcha_rate: number }>;
  errorClasses: string[];
  errorClassDistribution: ClassDist[];
  dailyErrorClassStack: Array<Record<string, any>>;
  totals: {
    total_failures: number;
    captcha_retry_exhausted: number;
    unresolved: number;
    affected_stocks: number;
    fallback_used: number;
  };
  generated_at: string;
};

const REASONS = [
  { value: 'all', label: '全部 reason' },
  { value: 'captcha_retry_exhausted', label: 'CAPTCHA 重試耗盡' },
  { value: 'http_block', label: 'HTTP 阻擋' },
  { value: 'empty_rows', label: '空資料' },
  { value: 'menu_parse_failed', label: '選單解析失敗' },
  { value: 'sync_failed', label: '其他同步失敗' },
];

// error_class 細分：OCR 空值 / OCR 字元辨識偏差 / 阻擋 / 空值 / 金鑰或欄位缺失
const ERROR_CLASSES = [
  { value: 'all', label: '全部細分類' },
  { value: 'ocr_null', label: 'OCR 空值 (無有效猜測)' },
  { value: 'ocr_mismatch', label: 'OCR 字元辨識偏差' },
  { value: 'captcha_retry_exhausted', label: 'CAPTCHA 耗盡 (無子分類)' },
  { value: 'captcha_http', label: 'CAPTCHA 圖片 HTTP 失敗' },
  { value: 'http_block_403', label: 'HTTP 403 阻擋' },
  { value: 'http_block_429', label: 'HTTP 429 節流' },
  { value: 'http_block', label: 'HTTP 阻擋 (其他)' },
  { value: 'menu_parse_failed', label: '金鑰/欄位缺失 (menu 解析)' },
  { value: 'empty_rows', label: '解析空值 (bsContent 空表)' },
  { value: 'db_insert_failed', label: 'DB 寫入失敗' },
  { value: 'unknown', label: '未分類' },
];

const CLASS_COLORS: Record<string, string> = {
  ocr_null: '#D97706',
  ocr_mismatch: '#B45309',
  captcha_retry_exhausted: '#F59E0B',
  captcha_http: '#EA580C',
  http_block_403: '#B23A48',
  http_block_429: '#DC2626',
  http_block: '#991B1B',
  menu_parse_failed: '#6D28D9',
  empty_rows: '#9CA3AF',
  db_insert_failed: '#0F766E',
  sync_failed: '#4B5563',
  unknown: '#374151',
};
const classColor = (c: string) => CLASS_COLORS[c] || '#4B5563';
const classLabel = (c: string) => ERROR_CLASSES.find((x) => x.value === c)?.label || c;

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  return s.slice(0, 10).replace(/-/g, '/');
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const relTime = (iso: string | null) => {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (mins <= 0) return '待重試';
  if (mins < 60) return `${mins} 分後`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} 小時後`;
  return `${Math.round(hrs / 24)} 天後`;
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function BsrFailureDashboardPage() {
  const [days, setDays] = useState(14);
  const [stockFilter, setStockFilter] = useState('');
  const [stockInput, setStockInput] = useState('');
  const [reason, setReason] = useState('all');
  const [errorClass, setErrorClass] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [auditStock, setAuditStock] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<Dashboard>({
    queryKey: ['bsr-failures', days, stockFilter, reason, errorClass],
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('days', String(days));
      if (stockFilter) qs.set('stock_id', stockFilter);
      if (reason !== 'all') qs.set('reason', reason);
      if (errorClass !== 'all') qs.set('error_class', errorClass);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `${functionUrl("tw-bsr-failure-dashboard")}?${qs.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const chartMax = useMemo(() => {
    const vals = (data?.globalDaily || []).flatMap((d) => [d.attempts, d.success]);
    return Math.max(1, ...vals);
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['stock_id', 'name', 'total_failures', 'captcha_retry_exhausted', 'other_failures', 'unresolved', 'latest_target_date', 'latest_reason', 'consecutive_failures', 'next_retry_at', 'fallback_as_of_date', 'fallback_lag_days'],
      ...data.perStock.map((p) => [
        p.stock_id, p.name || '', p.total_failures, p.captcha_retry_exhausted, p.other_failures, p.unresolved,
        p.latest_target_date || '', p.latest_reason || '', p.consecutive_failures, p.next_retry_at || '',
        p.fallback_as_of_date || '', p.fallback_lag_days ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bsr-failures-${data.range.from}_${data.range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('已匯出 CSV');
  };

  return (
    <CompanyLayout>
      <SEO title="BSR OCR 失敗看板｜Legendflow 後台" description="逐檔追蹤 TWSE BSR 分點抓取的 CAPTCHA 失敗率與 fallback 對齊日" />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-medium tracking-tight text-foreground">BSR OCR 失敗看板</h1>
            <p className="text-[13px] text-foreground/60 mt-1">
              逐股票追蹤 CAPTCHA 重試耗盡率、HTTP 阻擋與 fallback 對齊日；資料範圍 {fmtDate(data?.range.from ?? null)} – {fmtDate(data?.range.to ?? null)}
              {data?.generated_at && <span className="ml-2">· 產生於 {fmtDateTime(data.generated_at)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />重新整理
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
              <Download className="h-3.5 w-3.5 mr-1.5" />匯出 CSV
            </Button>
          </div>
        </div>

        {/* 篩選列 */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-foreground/60">觀察區間</label>
              <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
                <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">近 7 天</SelectItem>
                  <SelectItem value="14">近 14 天</SelectItem>
                  <SelectItem value="30">近 30 天</SelectItem>
                  <SelectItem value="60">近 60 天</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-foreground/60">失敗原因 (reason)</label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-foreground/60">錯誤細分類 (error_class)</label>
              <Select value={errorClass} onValueChange={setErrorClass}>
                <SelectTrigger className="w-56 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ERROR_CLASSES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-foreground/60">股票代號</label>
              <div className="flex gap-1">
                <Input
                  value={stockInput}
                  onChange={(e) => setStockInput(e.target.value.trim())}
                  onKeyDown={(e) => { if (e.key === 'Enter') setStockFilter(stockInput); }}
                  placeholder="例如 2330"
                  className="h-9 w-36"
                />
                <Button size="sm" variant="secondary" onClick={() => setStockFilter(stockInput)}>套用</Button>
                {stockFilter && (
                  <Button size="sm" variant="ghost" onClick={() => { setStockFilter(''); setStockInput(''); }}>清除</Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: '失敗總次數', value: data?.totals.total_failures ?? 0 },
            { label: 'CAPTCHA 耗盡', value: data?.totals.captcha_retry_exhausted ?? 0, tone: 'amber' },
            { label: '未解決', value: data?.totals.unresolved ?? 0, tone: 'red' },
            { label: '受影響檔數', value: data?.totals.affected_stocks ?? 0 },
            { label: '使用 fallback', value: data?.totals.fallback_used ?? 0, tone: 'amber' },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="text-[11px] text-foreground/60">{k.label}</div>
                <div
                  className="text-[22px] font-medium mt-1 tabular-nums"
                  style={{ color: k.tone === 'amber' ? '#B45309' : k.tone === 'red' ? '#B23A48' : undefined }}
                >
                  {k.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 全域趨勢圖 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-medium">每日抓取結果（來自 tw_bsr_sync_metrics）</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <div className="text-sm text-foreground/60">載入中…</div>}
            {error && <div className="text-sm text-destructive">載入失敗：{String((error as Error).message)}</div>}
            {data && data.globalDaily.length === 0 && <div className="text-sm text-foreground/60">此區間尚無指標資料</div>}
            {data && data.globalDaily.length > 0 && (
              <div className="space-y-2">
                {data.globalDaily.map((d) => (
                  <div key={d.date} className="flex items-center gap-3 text-[12px]">
                    <div className="w-24 text-foreground/70 tabular-nums">{fmtDate(d.date)}</div>
                    <div className="flex-1 h-5 bg-foreground/5 rounded relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-foreground/70" style={{ width: `${(d.success / chartMax) * 100}%` }} title={`成功 ${d.success}`} />
                      <div
                        className="absolute inset-y-0"
                        style={{
                          left: `${(d.success / chartMax) * 100}%`,
                          width: `${(d.ocr_fail / chartMax) * 100}%`,
                          background: '#B45309',
                        }}
                        title={`CAPTCHA ${d.ocr_fail}`}
                      />
                      <div
                        className="absolute inset-y-0"
                        style={{
                          left: `${((d.success + d.ocr_fail) / chartMax) * 100}%`,
                          width: `${(d.http_block / chartMax) * 100}%`,
                          background: '#B23A48',
                        }}
                        title={`HTTP 阻擋 ${d.http_block}`}
                      />
                      <div
                        className="absolute inset-y-0"
                        style={{
                          left: `${((d.success + d.ocr_fail + d.http_block) / chartMax) * 100}%`,
                          width: `${(d.empty / chartMax) * 100}%`,
                          background: '#9CA3AF',
                        }}
                        title={`空資料 ${d.empty}`}
                      />
                    </div>
                    <div className="w-40 text-right tabular-nums text-foreground/70">
                      {d.attempts} 次 · CAPTCHA <span style={{ color: '#B45309' }}>{pct(d.captcha_rate)}</span>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 text-[11px] text-foreground/60 mt-3 pt-3 border-t">
                  <Legend color="hsl(var(--foreground))" opacity={0.7} label="成功" />
                  <Legend color="#B45309" label="CAPTCHA 耗盡" />
                  <Legend color="#B23A48" label="HTTP 阻擋" />
                  <Legend color="#9CA3AF" label="空資料" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 每日錯誤細分類 (error_class) 堆疊圖 + 分佈 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-medium">
              每日錯誤細分類堆疊（依 error_class）
              <span className="ml-2 text-[11px] text-foreground/50 font-normal">
                將 captcha_retry_exhausted 拆成 OCR 空值 / 字元辨識偏差，並涵蓋 HTTP 阻擋、金鑰欄位缺失、解析空值等
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data && (data.dailyErrorClassStack?.length ?? 0) === 0 && (
              <div className="text-sm text-foreground/60">此區間沒有可堆疊的失敗資料</div>
            )}
            {data && (data.dailyErrorClassStack?.length ?? 0) > 0 && (
              <div className="space-y-4">
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={data.dailyErrorClassStack} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--foreground) / 0.08)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--foreground) / 0.6)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--foreground) / 0.6)' }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, background: 'hsl(var(--background))', border: '1px solid hsl(var(--foreground) / 0.15)' }}
                        formatter={(v: any, k: any) => [`${v} 件`, classLabel(String(k))]}
                      />
                      <RcLegend
                        wrapperStyle={{ fontSize: 11 }}
                        formatter={(v: any) => classLabel(String(v))}
                      />
                      {(data.errorClasses || []).map((c) => (
                        <Bar key={c} dataKey={c} stackId="err" fill={classColor(c)} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* 分佈總覽 */}
                {data.errorClassDistribution && data.errorClassDistribution.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t">
                    {data.errorClassDistribution.map((d) => (
                      <div key={d.error_class} className="flex items-center gap-2 text-[11px] p-2 rounded" style={{ background: 'hsl(var(--foreground) / 0.03)' }}>
                        <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: classColor(d.error_class) }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-foreground/80 truncate">{classLabel(d.error_class)}</div>
                          <div className="text-foreground/50 tabular-nums">
                            {d.count} 件 · {pct(d.share)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>



        {/* Top Offenders */}
        {data && data.topOffenders.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[14px] font-medium flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" style={{ color: '#B45309' }} />
                Top Offenders（近 {days} 天 CAPTCHA 率最高）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-foreground/60 border-b">
                      <th className="text-left py-2 font-normal">代號 / 名稱</th>
                      <th className="text-right py-2 font-normal">失敗</th>
                      <th className="text-right py-2 font-normal">CAPTCHA</th>
                      <th className="text-right py-2 font-normal">率</th>
                      <th className="text-right py-2 font-normal">連續</th>
                      <th className="text-left py-2 font-normal pl-4">下次重試</th>
                      <th className="text-left py-2 font-normal pl-4">Fallback 對齊日</th>
                      <th className="text-right py-2 font-normal pl-4">Audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topOffenders.map((p) => (
                      <tr key={p.stock_id} className="border-b border-foreground/5 tabular-nums">
                        <td className="py-2">
                          <span className="font-medium">{p.stock_id}</span>
                          {p.name && <span className="text-foreground/60 ml-2">{p.name}</span>}
                        </td>
                        <td className="text-right">{p.total_failures}</td>
                        <td className="text-right" style={{ color: '#B45309' }}>{p.captcha_retry_exhausted}</td>
                        <td className="text-right" style={{ color: p.captcha_rate >= 0.5 ? '#B23A48' : '#B45309' }}>{pct(p.captcha_rate)}</td>
                        <td className="text-right">{p.consecutive_failures}</td>
                        <td className="pl-4 text-foreground/70">{relTime(p.next_retry_at)}</td>
                        <td className="pl-4">
                          {p.fallback_as_of_date ? (
                            <span>
                              {fmtDate(p.fallback_as_of_date)}
                              {p.fallback_lag_days !== null && p.fallback_lag_days > 0 && (
                                <Badge variant="secondary" className="ml-2 text-[10px]" style={{ background: '#FEF3C7', color: '#92400E' }}>
                                  T-{p.fallback_lag_days}
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <span className="text-foreground/40">無 fallback</span>
                          )}
                        </td>
                        <td className="pl-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setAuditStock(p.stock_id)}
                            data-testid={`audit-btn-${p.stock_id}`}
                          >
                            <Search className="h-3 w-3 mr-1" />Audit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Per-stock 明細 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] font-medium">逐檔失敗明細（{data?.perStock.length ?? 0} 檔）</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.perStock.length === 0 && (
              <div className="text-sm text-foreground/60 py-6 text-center">此區間沒有失敗紀錄 🎉</div>
            )}
            <div className="divide-y divide-foreground/5">
              {(data?.perStock || []).map((p) => {
                const isOpen = expanded === p.stock_id;
                return (
                  <div key={p.stock_id}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : p.stock_id)}
                      className="w-full flex items-center gap-3 py-3 text-left hover:bg-foreground/5 px-2 rounded"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium">
                          {p.stock_id}
                          {p.name && <span className="text-foreground/60 ml-2 font-normal">{p.name}</span>}
                        </div>
                        <div className="text-[11px] text-foreground/60 mt-0.5">
                          最新失敗：{fmtDate(p.latest_target_date)} · {p.latest_reason || '—'}
                          {p.unresolved > 0 && <span className="ml-2 text-[#B23A48]">未解決 {p.unresolved}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[12px] tabular-nums">
                        <span style={{ color: '#B45309' }}>CAPTCHA {p.captcha_retry_exhausted}</span>
                        <span className="text-foreground/50">其他 {p.other_failures}</span>
                        {p.fallback_as_of_date && (
                          <Badge variant="secondary" className="text-[10px]" style={{ background: '#FEF3C7', color: '#92400E' }}>
                            Fallback {fmtDate(p.fallback_as_of_date)}
                            {p.fallback_lag_days !== null && p.fallback_lag_days > 0 && ` · T-${p.fallback_lag_days}`}
                          </Badge>
                        )}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="pl-8 pr-2 pb-4 space-y-2">
                        <div className="text-[11px] text-foreground/60">
                          連續失敗 {p.consecutive_failures} 次 · 下次重試：{relTime(p.next_retry_at)}（{fmtDateTime(p.next_retry_at)}）
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                          {p.dailyBreakdown.map((d, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded" style={{ background: 'hsl(var(--foreground) / 0.03)' }}>
                              <div className="w-20 tabular-nums text-foreground/70">{fmtDate(d.date)}</div>
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                                style={{
                                  color: classColor(d.error_class),
                                  borderColor: classColor(d.error_class),
                                }}
                                title={`reason=${d.reason} · class=${d.error_class}`}
                              >
                                {classLabel(d.error_class)}
                              </Badge>
                              {d.reason && d.reason !== d.error_class && (
                                <span className="text-[10px] text-foreground/40">/ {d.reason}</span>
                              )}
                              <span className="text-foreground/60 ml-auto">
                                嘗試 {d.attempts} 次 {d.resolved && <span className="text-emerald-700 ml-1">已解決</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                        {p.fallback_as_of_date && (
                          <div className="text-[11px] p-2 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                            <AlertTriangle className="inline h-3 w-3 mr-1" />
                            前端 rollup 目前對齊到 <b>{fmtDate(p.fallback_as_of_date)}</b>
                            {p.fallback_lag_days !== null && p.fallback_lag_days > 0 && ` （距今 ${p.fallback_lag_days} 天）`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
      <BsrAuditDialog
        stockId={auditStock}
        open={!!auditStock}
        onOpenChange={(v) => { if (!v) setAuditStock(null); }}
      />
    </CompanyLayout>
  );
}

function Legend({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color, opacity }} />
      {label}
    </span>
  );
}
