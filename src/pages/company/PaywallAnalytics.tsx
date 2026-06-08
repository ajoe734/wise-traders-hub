import { SEO } from '@/components/SEO';
import { useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';

// W4-4 Paywall analytics — 顯示最近 30 天各 surface/variant 的曝光、限制觸發、點擊與轉換率。

interface Row {
  surface: string;
  variant: string;
  event_kind: string;
}

export default function PaywallAnalytics() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['paywall-events-30d'],
    queryFn: async (): Promise<Row[]> => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('paywall_events')
        .select('surface, variant, event_kind')
        .gte('created_at', since)
        .limit(50000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  const summary = useMemo(() => {
    const rows = data ?? [];
    // group by surface+variant
    const map = new Map<string, { surface: string; variant: string; view: number; hit_limit: number; click_upgrade: number; dismiss: number }>();
    for (const r of rows) {
      const key = `${r.surface}|${r.variant || '?'}`;
      if (!map.has(key)) map.set(key, { surface: r.surface, variant: r.variant || '?', view: 0, hit_limit: 0, click_upgrade: 0, dismiss: 0 });
      const cur = map.get(key)!;
      if (r.event_kind === 'view') cur.view++;
      else if (r.event_kind === 'hit_limit') cur.hit_limit++;
      else if (r.event_kind === 'click_upgrade') cur.click_upgrade++;
      else if (r.event_kind === 'dismiss') cur.dismiss++;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.surface === b.surface ? a.variant.localeCompare(b.variant) : a.surface.localeCompare(b.surface),
    );
  }, [data]);

  const totals = useMemo(() => {
    const t = { view: 0, hit_limit: 0, click_upgrade: 0, dismiss: 0 };
    for (const r of summary) {
      t.view += r.view;
      t.hit_limit += r.hit_limit;
      t.click_upgrade += r.click_upgrade;
      t.dismiss += r.dismiss;
    }
    return t;
  }, [summary]);

  const fmtPct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

  return (
    <>
      <SEO title="Paywall 轉換分析 | legendflow 後台" description="Paywall 曝光、觸限與轉換 A/B 數據" />
      <CompanyLayout title="Paywall 轉換分析" subtitle="最近 30 天，按 surface × variant 拆分">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">View</CardTitle></CardHeader><CardContent className="text-xl font-medium tabular-nums">{totals.view}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Hit Limit</CardTitle></CardHeader><CardContent className="text-xl font-medium tabular-nums">{totals.hit_limit}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Click Upgrade</CardTitle></CardHeader><CardContent className="text-xl font-medium tabular-nums">{totals.click_upgrade}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">CTR (click/view)</CardTitle></CardHeader><CardContent className="text-xl font-medium tabular-nums">{fmtPct(totals.click_upgrade, totals.view)}</CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="w-4 h-4" />Surface × Variant 拆分</CardTitle>
            </CardHeader>
            <CardContent>
              {isFetching && <div className="text-sm text-muted-foreground">載入中…</div>}
              {!isFetching && summary.length === 0 && <div className="text-sm text-muted-foreground">最近 30 天尚無資料</div>}
              {!isFetching && summary.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b text-xs text-muted-foreground">
                        <th className="py-2 pr-4">Surface</th>
                        <th className="py-2 pr-4">Variant</th>
                        <th className="py-2 pr-4 text-right">View</th>
                        <th className="py-2 pr-4 text-right">Hit Limit</th>
                        <th className="py-2 pr-4 text-right">Click</th>
                        <th className="py-2 pr-4 text-right">CTR</th>
                        <th className="py-2 text-right">轉換率（click/hit）</th>
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
              <button onClick={() => refetch()} className="mt-3 text-xs text-muted-foreground underline">重新整理</button>
            </CardContent>
          </Card>
        </div>
      </CompanyLayout>
    </>
  );
}
