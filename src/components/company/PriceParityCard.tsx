import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface ParityRow {
  symbol: string;
  market: string;
  hits: number;
  avg_diff_pct: number;
  max_diff_pct: number;
  last_seen: string;
}
interface ParitySummary {
  totals: { events?: number; symbols?: number; avg_diff_pct?: number; max_diff_pct?: number };
  top: ParityRow[];
}

export function PriceParityCard({ days }: { days: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['company', 'price-parity', days],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_price_parity_summary', { _days: days });
      if (error) throw error;
      return data as unknown as ParitySummary;
    },
  });

  const totals = data?.totals || {};
  const rows = data?.top || [];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-[14px] font-medium">價格一致性事件</CardTitle>
        <div className="text-[11px] text-foreground/55 mt-1">
          持倉看板 DB 價 vs LocalStorage 快取落差 &gt; 0.5% 的事件
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Mini label="事件數" value={String(totals.events ?? 0)} />
          <Mini label="涉及個股" value={String(totals.symbols ?? 0)} />
          <Mini label="平均落差" value={totals.avg_diff_pct != null ? `${totals.avg_diff_pct}%` : '—'} />
          <Mini label="最大落差" value={totals.max_diff_pct != null ? `${totals.max_diff_pct}%` : '—'} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-foreground/55 border-b border-foreground/10">
                <th className="py-2 pr-4">代號</th>
                <th className="py-2 pr-4">市場</th>
                <th className="py-2 pr-4 text-right">次數</th>
                <th className="py-2 pr-4 text-right">平均差</th>
                <th className="py-2 pr-4 text-right">最大差</th>
                <th className="py-2 text-right">最近</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.symbol}-${r.market}`} className="border-b border-foreground/5">
                  <td className="py-2 pr-4 font-mono text-[12px]">{r.symbol}</td>
                  <td className="py-2 pr-4"><Badge variant="secondary">{r.market}</Badge></td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.hits}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.avg_diff_pct}%</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.max_diff_pct}%</td>
                  <td className="py-2 text-right text-[12px] text-foreground/60">
                    {new Date(r.last_seen).toLocaleString('zh-TW', { hour12: false })}
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-foreground/50">近 {days} 天無落差事件</td></tr>
              )}
              {isLoading && (
                <tr><td colSpan={6} className="py-6 text-center text-foreground/50">載入中…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-foreground/10 p-3">
      <div className="text-[11px] text-foreground/55">{label}</div>
      <div className="text-[18px] font-medium tracking-tight mt-1 tabular-nums">{value}</div>
    </div>
  );
}
