import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Download, RefreshCw } from 'lucide-react';
import { conversionRate, signupRate, toCsv, totals, type SourceRow } from '@/lib/analytics/marketingReport';

const fmtDate = (d: Date) => {
  const t = new Date(d.getTime() + 8 * 3600_000);
  return t.toISOString().slice(0, 10);
};
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);
const num = (n: number) => n.toLocaleString('zh-TW');

/** 後台「行銷來源報表」：依 utm_medium / campaign / content 彙總，僅數字，無個資。 */
export default function MarketingSources() {
  const [from, setFrom] = useState(() => fmtDate(new Date(Date.now() - 29 * 86400_000)));
  const [to, setTo] = useState(() => fmtDate(new Date()));
  const range = useMemo(() => ({
    from: new Date(`${from}T00:00:00+08:00`).toISOString(),
    to: new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400_000).toISOString(),
  }), [from, to]);

  const { data = [], isFetching, error, refetch } = useQuery({
    queryKey: ['marketing-sources', range.from, range.to],
    queryFn: async (): Promise<SourceRow[]> => {
      const { data, error } = await supabase.rpc('get_marketing_source_report', { _from: range.from, _to: range.to });
      if (error) throw error;
      return ((data ?? []) as SourceRow[]).map((r) => ({
        ...r, visitors: Number(r.visitors), signups: Number(r.signups), purchases: Number(r.purchases), revenue: Number(r.revenue), leads: Number(r.leads),
      }));
    },
  });
  const sum = totals(data);

  const exportCsv = () => {
    const blob = new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `marketing-sources_${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <CompanyLayout>
      <SEO title="行銷來源報表｜後台分析" description="依 UTM 彙總的訪客、註冊、購買與活動報名" />
      <div className="space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">行銷來源報表</h1>
            <p className="text-sm text-foreground/60 mt-1">首次接觸來源（30 天），沒有 UTM 記為 direct；日期以台北時間計</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1"><Label htmlFor="ms-from" className="text-xs">開始</Label>
              <Input id="ms-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
            <div className="space-y-1"><Label htmlFor="ms-to" className="text-xs">結束</Label>
              <Input id="ms-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={'w-4 h-4 mr-1 ' + (isFetching ? 'animate-spin' : '')} />重新整理
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={!data.length}><Download className="w-4 h-4 mr-1" />匯出 CSV</Button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['訪客數', num(sum.visitors)], ['註冊數', num(sum.signups)], ['購買數', num(sum.purchases)], ['營收', `NT$${num(sum.revenue)}`], ['活動報名數', num(sum.leads)]].map(([k, v]) => (
            <Card key={k}><CardContent className="p-4"><p className="text-xs text-foreground/60">{k}</p><p className="text-xl font-semibold mt-1">{v}</p></CardContent></Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">依來源分組</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {error ? <p className="text-sm text-destructive">讀取失敗：{(error as Error).message}</p>
              : data.length === 0 ? <p className="text-sm text-foreground/60">{isFetching ? '載入中…' : '此區間沒有資料'}</p>
              : (
              <table className="w-full text-sm">
                <thead className="text-xs text-foreground/60 text-left">
                  <tr>
                    <th className="py-2 pr-4">utm_medium</th><th className="py-2 pr-4">utm_campaign</th><th className="py-2 pr-4">utm_content</th>
                    <th className="py-2 pr-4 text-right">訪客</th><th className="py-2 pr-4 text-right">註冊</th><th className="py-2 pr-4 text-right">購買</th>
                    <th className="py-2 pr-4 text-right">營收</th><th className="py-2 pr-4 text-right">活動報名</th>
                    <th className="py-2 pr-4 text-right">註冊率</th><th className="py-2 text-right">購買轉換率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={`${r.utm_medium}|${r.utm_campaign}|${r.utm_content}`} className="border-t border-border/50">
                      <td className="py-2 pr-4 font-medium">{r.utm_medium}</td><td className="py-2 pr-4">{r.utm_campaign}</td><td className="py-2 pr-4">{r.utm_content}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(r.visitors)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(r.signups)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(r.purchases)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">NT${num(r.revenue)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(r.leads)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{pct(signupRate(r.signups, r.visitors))}</td>
                      <td className="py-2 text-right tabular-nums">{pct(conversionRate(r.purchases, r.visitors))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
