import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2 } from 'lucide-react';
import { MONTHLY_FREE_LIMIT, computePayroll, payDate, prevMonth, taipeiMonth } from '@/lib/expertPayroll';
import { preparePayrollData } from '@/lib/payrollStatement';
import { buildPayrollExportRows } from '@/lib/payrollExport';
import { exportCSV, fmtDate, fmtMoney } from '@/pages/_companyRevenue/utils';

const monthLabel = (m: string) => m.replace('-', '/');

/** 老師對帳明細：與管理員月結薪資同一算法，只讀本人資料（後台函式驗證身分）。 */
export function PayrollStatement({ expertSlug }: { expertSlug?: string }) {
  const current = taipeiMonth(new Date().toISOString());
  const [month, setMonth] = useState(prevMonth(current));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-payroll-statement', expertSlug],
    enabled: !!expertSlug,
    queryFn: async () => {
      const { data: ex, error: exErr } = await supabase.from('experts').select('id, name').eq('slug', expertSlug!).maybeSingle();
      if (exErr) throw exErr;
      if (!ex) throw new Error('找不到老師');
      const { data: raw, error: fnErr } = await supabase.functions.invoke('expert-payroll-statement', { body: { expert_id: ex.id } });
      if (fnErr) throw fnErr;
      return { expert: ex, d: preparePayrollData(raw) };
    },
  });

  const row = useMemo(() => {
    if (!data) return null;
    const p = computePayroll(data.d.splits, data.d.txs, data.d.refundAt, data.d.subUser, data.d.locks, current, data.d.subCycle,
      { limit: MONTHLY_FREE_LIMIT, excludedTx: data.d.excludedTx });
    return p[data.expert.id] || {};
  }, [data, current]);

  const months = useMemo(() => {
    const set = new Set<string>([prevMonth(current), current, ...Object.keys(row || {})]);
    return [...set].sort().reverse();
  }, [row, current]);

  const r = row?.[month];
  const freeCount = r ? r.items.filter((it) => it.free).length : 0;

  const download = () => {
    if (!data || !r) return;
    const d = data.d;
    exportCSV(`payroll-${month}-${data.expert.name}.csv`, buildPayrollExportRows([r], {
      expertName: () => data.expert.name,
      memberKey: (s) => (s ? d.subUser[s] : undefined),
      memberName: (s) => (s ? d.names[d.subUser[s]] || '' : ''),
      planName: (s) => (s ? d.planNames[d.subPlan[s]] || '' : ''),
      cycle: (s) => (s ? d.subCycle[s] || '' : ''),
      fmtDate,
    }));
  };

  return (
    <Card data-testid="payroll-statement">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold mr-auto">對帳明細</h2>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[140px] h-9" aria-label="選擇月份"><SelectValue /></SelectTrigger>
            <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!r || r.items.length === 0} onClick={download}>
            <Download className="h-4 w-4 mr-2" />下載對帳明細{r ? `（${r.items.length} 筆）` : ''}
          </Button>
        </div>

        <div className="rounded-md border p-3 text-sm space-y-1">
          <div className="font-bold">本月前 {MONTHLY_FREE_LIMIT} 筆不抽成</div>
          <p className="text-muted-foreground">
            每個月薪資裡，依付款時間排序的前 {MONTHLY_FREE_LIMIT} 筆，平台不抽成，這幾筆你拿淨收全額；第 {MONTHLY_FREE_LIMIT + 1} 筆起照原本比例分潤。每個月重新計算。年繳每月認列的那一期算 1 筆；測試帳號與持倉健檢不佔名額。明細最後一欄會標「是／否」。
          </p>
          <p className="text-muted-foreground">
            薪資依服務期滿月計價：付款日加一個週期的期滿日落在哪個月，就算在哪個月；年繳拆 12 期。期滿前退款，未滿期的部分不計。於隔月 5 號發放。
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin mr-2" />載入中...</div>
        ) : error ? (
          <div className="text-sm text-destructive">讀取失敗 <Button size="sm" variant="link" onClick={() => refetch()}>重試</Button></div>
        ) : !r || (r.items.length === 0 && r.amount === 0) ? (
          <div className="text-sm text-muted-foreground">{monthLabel(month)} 沒有分潤紀錄</div>
        ) : (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-muted-foreground text-xs">應發</dt><dd className="text-[22px] font-medium">{fmtMoney(r.amount)}</dd></div>
            <div><dt className="text-muted-foreground text-xs">會員／筆數</dt><dd>{r.student_count} 位／{r.items.length} 筆</dd></div>
            <div><dt className="text-muted-foreground text-xs">不抽成筆數</dt><dd>{freeCount} 筆</dd></div>
            <div><dt className="text-muted-foreground text-xs">發放日</dt><dd>{payDate(month)}{r.locked ? '（已發放）' : ''}</dd></div>
            {month >= current && <div className="col-span-full text-xs text-muted-foreground">本月尚未結束，數字仍會變動。</div>}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
