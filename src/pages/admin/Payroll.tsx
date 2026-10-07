import { SEO } from '@/components/SEO';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { payDate } from '@/lib/expertPayroll';
import { Loader2 } from 'lucide-react';

const fmt = (n: number) => `NT$ ${Math.round(Number(n) || 0).toLocaleString('zh-TW')}`;
const fmtDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return d.replace(/-/g, '/');
};

/** 老師「我的薪資」：只顯示管理員已標記發放的月份（RLS 限本人＋status=paid）。 */
const AdminPayroll = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-payroll', expertSlug],
    enabled: !!expertSlug,
    queryFn: async () => {
      const { data: ex } = await supabase.from('experts').select('id').eq('slug', expertSlug!).maybeSingle();
      if (!ex) return [];
      const { data: rows, error } = await (supabase.from as any)('expert_payouts')
        .select('period_month, earnings, clawback, carry_in, amount, clawback_items, recognition_items, tx_count, student_count, paid_at, status')
        .eq('expert_id', ex.id).eq('status', 'paid').order('period_month', { ascending: false });
      if (error) throw error;
      return rows || [];
    },
  });

  return (
    <AdminLayout>
      <SEO title={'我的薪資 | legendflow'} description={'每月已發放薪資明細。'} path={`/admin/${expertSlug || ''}/payroll`} noindex />
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">我的薪資</h1>
          <p className="text-sm text-muted-foreground mt-1">每月薪資於隔月 5 號發放，依服務期滿月計價（年繳每滿一個月計 1/12）；此處只顯示已發放的月份。</p>
        </div>
        {isLoading && <div className="flex items-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />載入中...</div>}
        {isError && <div className="text-sm text-destructive">載入失敗，請重新整理</div>}
        {!isLoading && !isError && !data?.length && <div className="text-sm text-muted-foreground">目前尚無已發放紀錄</div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data || []).map((r: any) => (
            <Card key={r.period_month}>
              <CardContent className="p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{r.period_month.replace('-', '/')} 薪資</span>
                  <Badge variant="secondary">已發放 {r.paid_at ? fmtDay(r.paid_at) : payDate(r.period_month)}</Badge>
                </div>
                <div className="text-xl font-bold">{fmt(r.amount)}</div>
                <div className="text-xs text-muted-foreground">學員 {r.student_count} 人／{r.tx_count} 筆付款</div>
                <div className="text-xs text-muted-foreground">當月分潤 {fmt(r.earnings)}</div>
                {Array.isArray(r.recognition_items) && r.recognition_items.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">期滿計入明細（{r.recognition_items.length} 筆）</summary>
                    {r.recognition_items.map((it: any, i: number) => (
                      <div key={i} className="flex justify-between text-muted-foreground">
                        <span>付款 {fmtDay(it.paid_at)} → 期滿 {fmtDay(it.end_at)}{it.n > 1 ? `（第 ${it.k}/${it.n} 期）` : ''}</span>
                        <span>{fmt(it.amount)}</span>
                      </div>
                    ))}
                  </details>
                )}
                {Number(r.clawback) > 0 && (
                  <div className="text-xs text-destructive space-y-0.5" data-testid="payroll-clawback">
                    <div>退款扣回 −{fmt(r.clawback)}</div>
                    {(Array.isArray(r.clawback_items) ? r.clawback_items : []).map((c: any, i: number) => (
                      <div key={i} className="text-muted-foreground">
                        · {String(c.fromMonth).replace('-', '/')} 薪資已發放後退款{c.refundMonth ? `（${String(c.refundMonth).replace('-', '/')} 退款）` : ''}，於本月扣回 −{fmt(c.amount)}
                      </div>
                    ))}
                  </div>
                )}
                {Number(r.carry_in) < 0 && <div className="text-xs text-muted-foreground">上月結轉 {fmt(r.carry_in)}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminPayroll;
