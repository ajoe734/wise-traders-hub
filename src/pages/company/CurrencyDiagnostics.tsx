import { SEO } from '@/components/SEO';
import { useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Coins, AlertTriangle } from 'lucide-react';
import { CURRENCY_SOURCE_LABEL, type CurrencySource } from '@/lib/currency';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  occurred_at: string;
  route: string | null;
  user_id: string | null;
  event_props: {
    signal_id?: string | null;
    expert_slug?: string | null;
    instrument?: string | null;
    resolved_currency?: string | null;
    source?: CurrencySource | null;
    had_explicit?: boolean | null;
    is_preview?: boolean | null;
  } | null;
}

const SOURCE_TONE: Record<CurrencySource, string> = {
  explicit: 'bg-success/15 text-success border-success/30',
  'inferred-instrument': 'bg-warning/15 text-warning border-warning/30',
  'default-fallback': 'bg-destructive/15 text-destructive border-destructive/30',
};

const KNOWN_SOURCES: CurrencySource[] = ['explicit', 'inferred-instrument', 'default-fallback'];

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export default function CurrencyDiagnosticsPage() {
  const [limit, setLimit] = useState(200);
  const [filterSource, setFilterSource] = useState<CurrencySource | 'all'>('all');
  const [q, setQ] = useState('');

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['company', 'currency-diagnostics', limit],
    staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('traffic_events')
        .select('id, occurred_at, route, user_id, event_props')
        .eq('event_name', 'signal_currency_resolution')
        .order('occurred_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = data ?? [];

  const stats = useMemo(() => {
    const counter: Record<CurrencySource, number> = {
      explicit: 0,
      'inferred-instrument': 0,
      'default-fallback': 0,
    };
    let unknown = 0;
    let hadExplicit = 0;
    let preview = 0;
    const bySignal = new Map<string, number>();
    for (const r of rows) {
      const src = r.event_props?.source;
      if (src && KNOWN_SOURCES.includes(src)) counter[src]++;
      else unknown++;
      if (r.event_props?.had_explicit) hadExplicit++;
      if (r.event_props?.is_preview) preview++;
      const sid = r.event_props?.signal_id;
      if (sid) bySignal.set(sid, (bySignal.get(sid) ?? 0) + 1);
    }
    const total = rows.length;
    const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    return {
      total,
      counter,
      unknown,
      hadExplicit,
      preview,
      distinctSignals: bySignal.size,
      pct,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterSource !== 'all' && r.event_props?.source !== filterSource) return false;
      if (!q.trim()) return true;
      const kw = q.trim().toLowerCase();
      const bag = [
        r.event_props?.signal_id,
        r.event_props?.expert_slug,
        r.event_props?.instrument,
        r.event_props?.resolved_currency,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return bag.includes(kw);
    });
  }, [rows, filterSource, q]);

  return (
    <CompanyLayout>
      <SEO title="幣別解析除錯｜營運後台 | legendflow" noindex />
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">幣別解析除錯</h1>
            <Badge variant="outline" className="text-[11px]">signal_currency_resolution</Badge>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">最近</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded border border-border bg-background px-2 text-sm"
              data-testid="cd-limit-select"
            >
              {[50, 100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>{n} 筆</option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
              重新載入
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <div>
                讀取失敗：{(error as Error).message}
                <div className="text-xs opacity-70 mt-1">請確認你具備 company_admin 權限。</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">樣本數</CardTitle></CardHeader>
            <CardContent className="pt-0 text-2xl font-semibold" data-testid="cd-total">{stats.total}</CardContent>
          </Card>
          {KNOWN_SOURCES.map((src) => (
            <Card key={src}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">{CURRENCY_SOURCE_LABEL[src]}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0" data-testid={`cd-stat-${src}`}>
                <div className="text-2xl font-semibold">{stats.counter[src]}</div>
                <div className="text-xs text-muted-foreground">{stats.pct(stats.counter[src])}%</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>相異 signal_id：{stats.distinctSignals}</span>
          <span>had_explicit：{stats.hadExplicit}（{stats.pct(stats.hadExplicit)}%）</span>
          <span>preview 模式：{stats.preview}</span>
          {stats.unknown > 0 && <span className="text-warning">未知 source：{stats.unknown}</span>}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <Input
              placeholder="搜尋 signal_id / expert / instrument / currency"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 max-w-sm text-sm"
              data-testid="cd-search"
            />
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={filterSource === 'all' ? 'default' : 'outline'}
                onClick={() => setFilterSource('all')}
              >
                全部
              </Button>
              {KNOWN_SOURCES.map((src) => (
                <Button
                  key={src}
                  size="sm"
                  variant={filterSource === src ? 'default' : 'outline'}
                  onClick={() => setFilterSource(src)}
                  data-testid={`cd-filter-${src}`}
                >
                  {CURRENCY_SOURCE_LABEL[src]}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              顯示 {filtered.length} / {stats.total} 筆
            </span>
          </CardContent>
        </Card>

        {/* Detail table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs" data-testid="cd-table">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2">時間</th>
                  <th className="px-3 py-2">signal_id</th>
                  <th className="px-3 py-2">導師</th>
                  <th className="px-3 py-2">instrument</th>
                  <th className="px-3 py-2">解析幣別</th>
                  <th className="px-3 py-2">來源</th>
                  <th className="px-3 py-2">explicit</th>
                  <th className="px-3 py-2">preview</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">尚無資料</td></tr>
                ) : (
                  filtered.map((r) => {
                    const p = r.event_props ?? {};
                    const src = (p.source ?? null) as CurrencySource | null;
                    return (
                      <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtTime(r.occurred_at)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] break-all">{p.signal_id ?? '—'}</td>
                        <td className="px-3 py-2">{p.expert_slug ?? '—'}</td>
                        <td className="px-3 py-2">{p.instrument ?? '—'}</td>
                        <td className="px-3 py-2 font-medium">{p.resolved_currency ?? '—'}</td>
                        <td className="px-3 py-2">
                          {src ? (
                            <Badge variant="outline" className={cn('text-[10px]', SOURCE_TONE[src])}>
                              {CURRENCY_SOURCE_LABEL[src]}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">未知</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{p.had_explicit ? '✓' : '—'}</td>
                        <td className="px-3 py-2">{p.is_preview ? '✓' : '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <p className="text-[11px] text-muted-foreground">
          資料來源：<code>traffic_events.event_name = 'signal_currency_resolution'</code>；建議
          <code className="mx-1">default-fallback</code> 比例應接近 0，若持續偏高代表某位導師未設定幣別，請至專家後台補齊。
        </p>
      </div>
    </CompanyLayout>
  );
}
