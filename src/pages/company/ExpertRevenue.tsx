import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { SEO } from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Download } from 'lucide-react';

// P3: 專家別營收與分潤儀表板（含 CSV 匯出）

type Row = {
  expert_id: string;
  expert_name: string | null;
  expert_slug: string | null;
  orders: number;
  gross: number;
  net: number;
  platform_amount: number;
  expert_amount: number;
  channel_reserve: number;
  unique_buyers: number;
};

const RANGES: Array<{ label: string; days: number }> = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
];

function toCsv(rows: Row[]): string {
  const header = ['expert_id', 'expert_name', 'expert_slug', 'orders', 'unique_buyers', 'gross', 'net', 'platform_amount', 'expert_amount', 'channel_reserve'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.expert_id,
      JSON.stringify(r.expert_name ?? ''),
      r.expert_slug ?? '',
      r.orders,
      r.unique_buyers,
      r.gross,
      r.net,
      r.platform_amount,
      r.expert_amount,
      r.channel_reserve,
    ].join(','));
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExpertRevenue() {
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<'gross' | 'expert_amount' | 'orders'>('gross');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['expert-revenue', days],
    queryFn: async () => {
      const from = new Date(Date.now() - days * 86400_000).toISOString();
      const to = new Date().toISOString();
      const { data, error } = await supabase.rpc('get_expert_revenue_breakdown', { _from: from, _to: to });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const sorted = useMemo(() => [...rows].sort((a, b) => (b[sort] as number) - (a[sort] as number)), [rows, sort]);
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    gross: acc.gross + Number(r.gross || 0),
    net: acc.net + Number(r.net || 0),
    platform: acc.platform + Number(r.platform_amount || 0),
    expert: acc.expert + Number(r.expert_amount || 0),
    orders: acc.orders + Number(r.orders || 0),
  }), { gross: 0, net: 0, platform: 0, expert: 0, orders: 0 }), [rows]);

  return (
    <CompanyLayout>
      <SEO title="專家分潤｜後台" description="專家別營收與分潤儀表板。" />
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">專家分潤</h1>
            <p className="text-sm text-foreground/60 mt-1">依專家統計毛收、淨額、平台與專家分潤；可匯出對帳 CSV。</p>
          </div>
          <div className="flex items-center gap-2">
            {RANGES.map((r) => (
              <Button
                key={r.days}
                size="sm"
                variant={days === r.days ? 'default' : 'outline'}
                onClick={() => setDays(r.days)}
              >
                {r.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => downloadCsv(`expert-revenue-${days}d.csv`, toCsv(sorted))} disabled={!rows.length}>
              <Download className="w-3.5 h-3.5 mr-1" /> 匯出 CSV
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiTile label="訂單數" value={totals.orders.toLocaleString()} />
          <KpiTile label="毛收" value={`$${Math.round(totals.gross).toLocaleString()}`} />
          <KpiTile label="淨額" value={`$${Math.round(totals.net).toLocaleString()}`} />
          <KpiTile label="平台分潤" value={`$${Math.round(totals.platform).toLocaleString()}`} />
          <KpiTile label="專家分潤" value={`$${Math.round(totals.expert).toLocaleString()}`} />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">專家排行</CardTitle>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-foreground/55">排序：</span>
              {([
                ['gross', '毛收'],
                ['expert_amount', '專家分潤'],
                ['orders', '訂單數'],
              ] as const).map(([k, l]) => (
                <Button key={k} variant={sort === k ? 'default' : 'outline'} size="sm" onClick={() => setSort(k)}>
                  {l}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <p className="text-sm text-foreground/50">載入中…</p>
            ) : sorted.length === 0 ? (
              <p className="text-sm text-foreground/50">區間內無分潤資料。</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-foreground/55 border-b">
                  <tr>
                    <th className="py-2 pr-3">專家</th>
                    <th className="py-2 pr-3 text-right">訂單</th>
                    <th className="py-2 pr-3 text-right">唯一買家</th>
                    <th className="py-2 pr-3 text-right">毛收</th>
                    <th className="py-2 pr-3 text-right">淨額</th>
                    <th className="py-2 pr-3 text-right">平台分潤</th>
                    <th className="py-2 pr-3 text-right">專家分潤</th>
                    <th className="py-2 pr-3 text-right">渠道保留</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.expert_id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {r.expert_slug ? (
                          <Link to={`/admin/${r.expert_slug}`} className="hover:underline">{r.expert_name || r.expert_id}</Link>
                        ) : (
                          r.expert_name || r.expert_id
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.orders}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.unique_buyers}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">${Math.round(r.gross).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">${Math.round(r.net).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">${Math.round(r.platform_amount).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">${Math.round(r.expert_amount).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">${Math.round(r.channel_reserve).toLocaleString()}</td>
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

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-foreground/55">{label}</div>
        <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
