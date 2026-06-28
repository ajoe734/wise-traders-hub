import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, TrendingUp } from 'lucide-react';

interface Row {
  utm_campaign: string;
  utm_source: string;
  utm_medium: string;
  spend: number;
  conversions_count: number;
  unique_buyers: number;
  gross_revenue: number;
  first_arpu: number;
  cac: number;
  roas: number;
  ltv_30d: number;
  ltv_90d: number;
  payback_ratio: number;
}

const PRESETS = [
  { id: '30', label: '近 30 天', days: 30 },
  { id: '60', label: '近 60 天', days: 60 },
  { id: '90', label: '近 90 天', days: 90 },
] as const;

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('zh-TW', { maximumFractionDigits: 0 }) : '—');
const fmtX = (n: number) => (Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}x` : '—');

export default function CompanyRoasLtv() {
  const [presetId, setPresetId] = useState<string>('30');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const from = useMemo(() => new Date(Date.now() - preset.days * 86400_000).toISOString(), [preset]);
  const to = useMemo(() => new Date().toISOString(), []);

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ['roas-ltv', presetId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_roas_ltv_by_campaign' as never, {
        _from: from,
        _to: to,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const totals = useMemo(() => {
    const t = rows.reduce(
      (acc, r) => {
        acc.spend += Number(r.spend) || 0;
        acc.gross += Number(r.gross_revenue) || 0;
        acc.buyers += Number(r.unique_buyers) || 0;
        acc.ltv90 += Number(r.ltv_90d) || 0;
        return acc;
      },
      { spend: 0, gross: 0, buyers: 0, ltv90: 0 },
    );
    return {
      ...t,
      roas: t.spend > 0 ? t.gross / t.spend : 0,
      cac: t.buyers > 0 && t.spend > 0 ? t.spend / t.buyers : 0,
      payback: t.spend > 0 ? t.ltv90 / t.spend : 0,
    };
  }, [rows]);

  return (
    <CompanyLayout>
      <SEO title="ROAS / LTV｜後台分析" description="廣告投入、訂單金額、CAC、ROAS、LTV30/90 端到端歸因。" />
      <div className="space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> ROAS / LTV
            </h1>
            <p className="text-sm text-foreground/60 mt-1">廣告花費 × 轉換 × 後續付款，按 utm_campaign 聚合。</p>
          </div>
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant={presetId === p.id ? 'default' : 'outline'} onClick={() => setPresetId(p.id)}>
                {p.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><div className="text-[10px] text-foreground/60">總花費</div><div className="text-xl font-semibold">${fmt(totals.spend)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[10px] text-foreground/60">總訂單金額</div><div className="text-xl font-semibold">${fmt(totals.gross)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[10px] text-foreground/60">ROAS</div><div className="text-xl font-semibold">{fmtX(totals.roas)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[10px] text-foreground/60">CAC</div><div className="text-xl font-semibold">${fmt(totals.cac)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[10px] text-foreground/60">90 天回本</div><div className="text-xl font-semibold">{fmtX(totals.payback)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">按 Campaign 拆解</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-foreground/60">{isFetching ? '載入中…' : '此區間無數據；可先到 /company/ad-spend 匯入花費。'}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-foreground/60 text-left">
                    <tr className="border-b">
                      <th className="py-2 pr-3">Campaign / Source</th>
                      <th className="py-2 pr-3 text-right">花費</th>
                      <th className="py-2 pr-3 text-right">訂單數</th>
                      <th className="py-2 pr-3 text-right">買家數</th>
                      <th className="py-2 pr-3 text-right">營收</th>
                      <th className="py-2 pr-3 text-right">首單 ARPU</th>
                      <th className="py-2 pr-3 text-right">CAC</th>
                      <th className="py-2 pr-3 text-right">ROAS</th>
                      <th className="py-2 pr-3 text-right">LTV 30d</th>
                      <th className="py-2 pr-3 text-right">LTV 90d</th>
                      <th className="py-2 pr-3 text-right">回本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.utm_campaign}-${r.utm_source}-${r.utm_medium}`} className="border-b">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{r.utm_campaign}</div>
                          <div className="text-foreground/50 text-[10px]">{r.utm_source} / {r.utm_medium}</div>
                        </td>
                        <td className="py-2 pr-3 text-right">${fmt(r.spend)}</td>
                        <td className="py-2 pr-3 text-right">{fmt(r.conversions_count)}</td>
                        <td className="py-2 pr-3 text-right">{fmt(r.unique_buyers)}</td>
                        <td className="py-2 pr-3 text-right">${fmt(r.gross_revenue)}</td>
                        <td className="py-2 pr-3 text-right">${fmt(r.first_arpu)}</td>
                        <td className="py-2 pr-3 text-right">${fmt(r.cac)}</td>
                        <td className="py-2 pr-3 text-right">
                          <Badge variant={r.roas >= 2 ? 'default' : r.roas >= 1 ? 'secondary' : 'destructive'}>{fmtX(r.roas)}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-right">${fmt(r.ltv_30d)}</td>
                        <td className="py-2 pr-3 text-right">${fmt(r.ltv_90d)}</td>
                        <td className="py-2 pr-3 text-right">{fmtX(r.payback_ratio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-[11px] text-foreground/50">
          備註：花費以月為粒度（ad_spend.yyyymm）落入區間內的月份；LTV 以該次轉換時間起 30/90 天內的成功付款金額。
        </p>
      </div>
    </CompanyLayout>
  );
}
