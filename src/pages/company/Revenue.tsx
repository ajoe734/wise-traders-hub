import { useState, useEffect, useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import {
  Download, Undo2, AlertTriangle, ChevronDown, ChevronRight, Search,
} from 'lucide-react';
import { toast } from 'sonner';

/* ----------------------------- 工具 ----------------------------- */
const fmtMoney = (n: number) => `NT$${(n || 0).toLocaleString()}`;
const fmtDate = (d?: string | null) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
};
const fmtDateTime = (d?: string | null) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${fmtDate(d)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

function getRangePreset(preset: string): { from: Date; to: Date } {
  const now = new Date();
  if (preset === 'this_month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }
  if (preset === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from, to };
  }
  if (preset === 'last_3m') {
    return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: now };
  }
  // ytd
  return { from: new Date(now.getFullYear(), 0, 1), to: now };
}

function exportCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const providerTypeLabels: Record<string, string> = {
  acpay: 'ACpay',
  ecpay: '綠界',
  newebpay: '藍新',
  line_pay: 'LINE Pay',
};

const ruleSourceLabels: Record<string, string> = {
  plan_override: '方案覆寫',
  standard_default: '標準預設',
  checkup_default: '健檢預設',
};

/* ============================== 主元件 ============================== */
const CompanyRevenue = () => {
  const { user } = useAuth();
  const [preset, setPreset] = useState<'this_month' | 'last_month' | 'last_3m' | 'ytd'>('this_month');
  const range = useMemo(() => getRangePreset(preset), [preset]);

  const [splits, setSplits] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [remittance, setRemittance] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [checkupSubs, setCheckupSubs] = useState<any[]>([]);
  const [experts, setExperts] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [checkupPlans, setCheckupPlans] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [paidTxTotalCount, setPaidTxTotalCount] = useState<number>(0);
  const [splitTotalCount, setSplitTotalCount] = useState<number>(0);

  const [refundingTx, setRefundingTx] = useState<any>(null);
  const [refundReason, setRefundReason] = useState('');

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [preset]);

  const fetchAll = async () => {
    const fromIso = range.from.toISOString();
    const toIso = range.to.toISOString();

    const [
      sp, tx, rm, sub, csub, exp, pl, cpl, prof, prov, txCount, spCount,
    ] = await Promise.all([
      supabase.from('revenue_splits').select('*')
        .gte('created_at', fromIso).lte('created_at', toIso)
        .order('created_at', { ascending: false }),
      supabase.from('payment_transactions').select('*')
        .gte('created_at', fromIso).lte('created_at', toIso)
        .order('created_at', { ascending: false }),
      supabase.from('remittance_orders').select('*')
        .gte('created_at', fromIso).lte('created_at', toIso)
        .order('created_at', { ascending: false }),
      supabase.from('member_subscriptions').select('*').order('started_at', { ascending: false }),
      supabase.from('checkup_subscriptions').select('*').order('started_at', { ascending: false }),
      supabase.from('experts').select('id, name, role, slug'),
      supabase.from('expert_plans').select('id, name, expert_id, plan_type, price_monthly, price_yearly'),
      supabase.from('checkup_plans').select('id, name, tier, price_monthly, price_yearly'),
      supabase.from('profiles').select('user_id, display_name'),
      supabase.from('payment_providers').select('id, display_name, provider_type'),
      supabase.from('payment_transactions').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
      supabase.from('revenue_splits').select('*', { count: 'exact', head: true }),
    ]);

    setSplits(sp.data || []);
    setTransactions(tx.data || []);
    setRemittance(rm.data || []);
    setSubscriptions(sub.data || []);
    setCheckupSubs(csub.data || []);
    setExperts(exp.data || []);
    setPlans(pl.data || []);
    setCheckupPlans(cpl.data || []);
    setProfiles(prof.data || []);
    setProviders(prov.data || []);
    setPaidTxTotalCount(txCount.count || 0);
    setSplitTotalCount(spCount.count || 0);
  };

  /* ----------------- 索引 map（後續多次 join 用） ----------------- */
  const expertMap = useMemo<Record<string, any>>(() => Object.fromEntries(experts.map(e => [e.id, e])), [experts]);
  const planMap = useMemo<Record<string, any>>(() => Object.fromEntries(plans.map(p => [p.id, p])), [plans]);
  const checkupPlanMap = useMemo<Record<string, any>>(() => Object.fromEntries(checkupPlans.map(p => [p.id, p])), [checkupPlans]);
  const profileMap = useMemo<Record<string, any>>(() => Object.fromEntries(profiles.map(p => [p.user_id, p])), [profiles]);
  const providerMap = useMemo<Record<string, any>>(() => Object.fromEntries(providers.map(p => [p.id, p])), [providers]);
  const subMap = useMemo<Record<string, any>>(() => Object.fromEntries(subscriptions.map(s => [s.id, s])), [subscriptions]);

  /* ----------------- 總覽聚合 ----------------- */
  const overview = useMemo(() => {
    const sum = (arr: any[], key: string) => arr.reduce((a, b) => a + (b[key] || 0), 0);
    const expertSplits = splits.filter(s => s.expert_id);
    const checkupSplits = splits.filter(s => !s.expert_id && !s.plan_id);
    const refundedTx = transactions.filter(t => t.status === 'refunded');

    return {
      gross: sum(splits, 'gross'),
      discount: sum(splits, 'discount'),
      net: sum(splits, 'net'),
      platformAmount: sum(splits, 'platform_amount'),
      expertAmount: sum(splits, 'expert_amount'),
      subscriptionGross: sum(expertSplits, 'gross'),
      checkupGross: sum(checkupSplits, 'gross'),
      refundAmount: refundedTx.reduce((a, b) => a + Math.abs(b.amount || 0), 0),
      refundCount: refundedTx.length,
      splitsCount: splits.length,
    };
  }, [splits, transactions]);

  // 月趨勢
  const monthTrend = useMemo(() => {
    const map: Record<string, { gross: number; platform: number; expert: number }> = {};
    splits.forEach(s => {
      const d = new Date(s.created_at);
      const k = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map[k]) map[k] = { gross: 0, platform: 0, expert: 0 };
      map[k].gross += s.gross || 0;
      map[k].platform += s.platform_amount || 0;
      map[k].expert += s.expert_amount || 0;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
  }, [splits]);

  // 來源拆分（信用卡 / 匯款 / LINE Pay / 健檢）
  const sourceBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    transactions.filter(t => t.status === 'paid').forEach(t => {
      const p = providerMap[t.provider_id];
      const label = p ? (providerTypeLabels[p.provider_type] || p.display_name) : '其他';
      buckets[label] = (buckets[label] || 0) + (t.amount || 0);
    });
    remittance.filter(r => r.status === 'confirmed').forEach(r => {
      buckets['匯款'] = (buckets['匯款'] || 0) + (r.amount || 0);
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [transactions, remittance, providerMap]);

  /* ----------------- 訂閱明細篩選 ----------------- */
  const [subFilter, setSubFilter] = useState({ expert: 'all', role: 'all', status: 'all', autorenew: 'all' });
  const filteredSubs = useMemo(() => {
    return subscriptions.filter(s => {
      const plan = planMap[s.plan_id];
      const exp = plan ? expertMap[plan.expert_id] : null;
      if (subFilter.expert !== 'all' && plan?.expert_id !== subFilter.expert) return false;
      if (subFilter.role !== 'all' && exp?.role !== subFilter.role) return false;
      if (subFilter.status !== 'all' && s.status !== subFilter.status) return false;
      if (subFilter.autorenew === 'on' && !s.auto_renew) return false;
      if (subFilter.autorenew === 'off' && s.auto_renew) return false;
      return true;
    });
  }, [subscriptions, subFilter, planMap, expertMap]);

  /* ----------------- 金流明細（合併 tx + remittance） ----------------- */
  const [txSearch, setTxSearch] = useState('');
  const [txStatus, setTxStatus] = useState<'all' | 'paid' | 'refunded' | 'pending' | 'failed'>('all');
  const txMerged = useMemo(() => {
    const list: any[] = [];

    transactions.forEach(t => {
      const sub = t.subscription_id ? subMap[t.subscription_id] : null;
      const plan = sub ? planMap[sub.plan_id] : null;
      const exp = plan ? expertMap[plan.expert_id] : null;
      const buyer = sub ? profileMap[sub.user_id] : null;
      const prov = providerMap[t.provider_id];
      list.push({
        kind: 'card',
        id: t.id,
        created_at: t.created_at,
        paid_at: t.paid_at,
        amount: t.amount,
        original_amount: t.original_amount,
        discount: t.discount_amount,
        discount_reason: t.discount_reason,
        status: t.status,
        provider_label: prov ? (providerTypeLabels[prov.provider_type] || prov.display_name) : '健檢/未知',
        product: plan ? `${plan.name}（訂閱）` : '健檢/未綁訂',
        buyer_name: buyer?.display_name || '-',
        expert_name: exp?.name || (plan ? '-' : '健檢'),
        provider_tx_id: t.provider_tx_id,
        raw: t,
      });
    });

    remittance.forEach(r => {
      const buyer = profileMap[r.user_id];
      const plan = r.plan_id ? planMap[r.plan_id] : null;
      const cplan = r.checkup_plan_id ? checkupPlanMap[r.checkup_plan_id] : null;
      const exp = plan ? expertMap[plan.expert_id] : null;
      list.push({
        kind: 'remit',
        id: r.id,
        created_at: r.created_at,
        paid_at: r.confirmed_at,
        amount: r.amount,
        original_amount: r.original_amount,
        discount: r.discount_amount,
        discount_reason: r.discount_reason,
        status: r.status === 'confirmed' ? 'paid' : r.status,
        provider_label: '匯款',
        product: plan ? `${plan.name}（訂閱）` : (cplan ? `${cplan.name}（健檢）` : '匯款'),
        buyer_name: buyer?.display_name || r.payer_name || '-',
        expert_name: exp?.name || (cplan ? '健檢' : '-'),
        provider_tx_id: `匯款末五碼 ${r.last5}`,
        raw: r,
      });
    });

    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [transactions, remittance, subMap, planMap, expertMap, profileMap, providerMap, checkupPlanMap]);

  const filteredTx = useMemo(() => {
    return txMerged.filter(r => {
      if (txStatus !== 'all' && r.status !== txStatus) return false;
      if (txSearch.trim()) {
        const q = txSearch.trim().toLowerCase();
        if (
          !r.buyer_name.toLowerCase().includes(q) &&
          !(r.expert_name || '').toLowerCase().includes(q) &&
          !(r.product || '').toLowerCase().includes(q) &&
          !(r.provider_tx_id || '').toLowerCase().includes(q) &&
          !String(r.amount).includes(q)
        ) return false;
      }
      return true;
    });
  }, [txMerged, txSearch, txStatus]);

  /* ----------------- 專家分潤對帳 ----------------- */
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);
  const expertPayouts = useMemo(() => {
    const map: Record<string, { count: number; gross: number; discount: number; net: number; platform: number; expert: number }> = {};
    splits.filter(s => s.expert_id).forEach(s => {
      if (!map[s.expert_id]) map[s.expert_id] = { count: 0, gross: 0, discount: 0, net: 0, platform: 0, expert: 0 };
      const m = map[s.expert_id];
      m.count += 1;
      m.gross += s.gross || 0;
      m.discount += s.discount || 0;
      m.net += s.net || 0;
      m.platform += s.platform_amount || 0;
      m.expert += s.expert_amount || 0;
    });
    return Object.entries(map).map(([eid, v]) => ({
      expert_id: eid,
      expert: expertMap[eid],
      ...v,
    })).sort((a, b) => b.expert - a.expert);
  }, [splits, expertMap]);

  const splitsByExpert = useMemo(() => {
    const map: Record<string, any[]> = {};
    splits.filter(s => s.expert_id).forEach(s => {
      if (!map[s.expert_id]) map[s.expert_id] = [];
      map[s.expert_id].push(s);
    });
    return map;
  }, [splits]);

  /* ----------------- 健檢營收 ----------------- */
  const checkupOverview = useMemo(() => {
    const cs = splits.filter(s => !s.expert_id && !s.plan_id);
    return {
      gross: cs.reduce((a, b) => a + (b.gross || 0), 0),
      discount: cs.reduce((a, b) => a + (b.discount || 0), 0),
      net: cs.reduce((a, b) => a + (b.net || 0), 0),
      count: cs.length,
    };
  }, [splits]);

  const checkupTrend = useMemo(() => {
    const map: Record<string, number> = {};
    splits.filter(s => !s.expert_id && !s.plan_id).forEach(s => {
      const d = new Date(s.created_at);
      const k = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[k] = (map[k] || 0) + (s.gross || 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, gross]) => ({ month, gross }));
  }, [splits]);

  /* ----------------- 退款 ----------------- */
  const handleRefund = async () => {
    if (!refundingTx) return;
    const { error } = await supabase.from('payment_transactions').update({ status: 'refunded' as any }).eq('id', refundingTx.raw.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from('audit_logs').insert({
      action: 'refund',
      actor_id: user?.id,
      target_type: 'payment_transaction',
      target_id: refundingTx.raw.id,
      detail: { reason: refundReason, amount: refundingTx.raw.amount, tx_id: refundingTx.raw.provider_tx_id },
    });
    toast.success('退款完成');
    setRefundingTx(null);
    setRefundReason('');
    fetchAll();
  };

  /* ============================== Render ============================== */
  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">對帳中心</h1>
            <p className="text-muted-foreground text-sm mt-1">會計口徑營收、訂閱、金流、專家分潤對帳（資料以 revenue_splits 為主）</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={preset} onValueChange={(v) => setPreset(v as any)}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">本月</SelectItem>
                <SelectItem value="last_month">上月</SelectItem>
                <SelectItem value="last_3m">近三個月</SelectItem>
                <SelectItem value="ytd">今年至今</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{fmtDate(range.from.toISOString())} ~ {fmtDate(range.to.toISOString())}</span>
          </div>
        </div>

        {/* 對帳健康度警示 */}
        {paidTxTotalCount !== splitTotalCount && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>對帳健康度警示</AlertTitle>
            <AlertDescription>
              已付款交易共 {paidTxTotalCount} 筆，但分潤紀錄只有 {splitTotalCount} 筆，差距 {Math.abs(paidTxTotalCount - splitTotalCount)} 筆。
              這可能是早期遺留交易未寫入 revenue_splits。對帳數字會以 revenue_splits 為準。
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">總覽</TabsTrigger>
            <TabsTrigger value="subscriptions">訂閱明細</TabsTrigger>
            <TabsTrigger value="transactions">金流明細</TabsTrigger>
            <TabsTrigger value="payouts">專家分潤</TabsTrigger>
            <TabsTrigger value="checkup">健檢營收</TabsTrigger>
          </TabsList>

          {/* ====================== 總覽 ====================== */}
          <TabsContent value="overview" className="mt-4 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="毛收" value={fmtMoney(overview.gross)} hint={`${overview.splitsCount} 筆分潤`} />
              <StatCard label="折扣" value={fmtMoney(overview.discount)} />
              <StatCard label="淨收（會計口徑）" value={fmtMoney(overview.net)} hint="不含退款" />
              <StatCard label="退款" value={fmtMoney(overview.refundAmount)} hint={`${overview.refundCount} 筆`} variant="destructive" />
              <StatCard label="平台應得" value={fmtMoney(overview.platformAmount)} variant="primary" />
              <StatCard label="專家應分總額" value={fmtMoney(overview.expertAmount)} variant="primary" />
              <StatCard label="訂閱毛收" value={fmtMoney(overview.subscriptionGross)} />
              <StatCard label="健檢毛收" value={fmtMoney(overview.checkupGross)} />
            </div>

            <Card>
              <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
                <p>• 「淨收」= revenue_splits 加總，不會因退款回沖。</p>
                <p>• 「實際淨收」≈ 淨收 − 退款 = <span className="font-medium text-foreground">{fmtMoney(overview.net - overview.refundAmount)}</span></p>
                <p>• 退款獨立顯示，因為 acpay-refund 只更新 payment_transactions.status，不會反沖 revenue_splits。</p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">月營收趨勢</CardTitle></CardHeader>
                <CardContent>
                  {monthTrend.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">尚無資料</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={monthTrend}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                        <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                        <Tooltip formatter={(v: number) => fmtMoney(v)} />
                        <Line type="monotone" dataKey="gross" name="毛收" stroke="hsl(var(--company))" strokeWidth={2} />
                        <Line type="monotone" dataKey="platform" name="平台" stroke="hsl(var(--primary))" strokeWidth={2} />
                        <Line type="monotone" dataKey="expert" name="專家" stroke="hsl(var(--mentor))" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">金流來源拆分</CardTitle></CardHeader>
                <CardContent>
                  {sourceBreakdown.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">尚無資料</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={sourceBreakdown} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={70} />
                        <Tooltip formatter={(v: number) => fmtMoney(v)} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
                          {sourceBreakdown.map((_, i) => (
                            <Cell key={i} fill="hsl(var(--company))" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ====================== 訂閱明細 ====================== */}
          <TabsContent value="subscriptions" className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={subFilter.expert} onValueChange={(v) => setSubFilter(s => ({ ...s, expert: v }))}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="全部專家" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部專家</SelectItem>
                  {experts.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={subFilter.role} onValueChange={(v) => setSubFilter(s => ({ ...s, role: v }))}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部角色</SelectItem>
                  <SelectItem value="advisor">分析師</SelectItem>
                  <SelectItem value="mentor">實戰導師</SelectItem>
                </SelectContent>
              </Select>
              <Select value={subFilter.status} onValueChange={(v) => setSubFilter(s => ({ ...s, status: v }))}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部狀態</SelectItem>
                  <SelectItem value="active">啟用</SelectItem>
                  <SelectItem value="cancelled">已取消</SelectItem>
                  <SelectItem value="expired">已到期</SelectItem>
                </SelectContent>
              </Select>
              <Select value={subFilter.autorenew} onValueChange={(v) => setSubFilter(s => ({ ...s, autorenew: v }))}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部續訂</SelectItem>
                  <SelectItem value="on">自動續訂</SelectItem>
                  <SelectItem value="off">已關閉</SelectItem>
                </SelectContent>
              </Select>
              <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={() => {
                  exportCSV(`subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, [
                    ['訂閱者', '方案', '專家', '角色', '週期', '狀態', '自動續訂', '起始日', '到期日'],
                    ...filteredSubs.map(s => {
                      const plan = planMap[s.plan_id];
                      const exp = plan ? expertMap[plan.expert_id] : null;
                      const buyer = profileMap[s.user_id];
                      return [
                        buyer?.display_name || '-',
                        plan?.name || '-',
                        exp?.name || '-',
                        exp?.role === 'mentor' ? '導師' : '分析師',
                        s.billing_cycle === 'yearly' ? '年' : '月',
                        s.status,
                        s.auto_renew ? '是' : '否',
                        fmtDate(s.started_at),
                        fmtDate(s.expires_at),
                      ];
                    }),
                  ]);
                }}>
                  <Download className="h-4 w-4 mr-2" />匯出
                </Button>
              </div>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3">訂閱者</th>
                      <th className="p-3">方案</th>
                      <th className="p-3">專家</th>
                      <th className="p-3">週期</th>
                      <th className="p-3">狀態</th>
                      <th className="p-3">自動續訂</th>
                      <th className="p-3">起始日</th>
                      <th className="p-3">到期日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubs.length === 0 ? (
                      <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">無資料</td></tr>
                    ) : filteredSubs.map(s => {
                      const plan = planMap[s.plan_id];
                      const exp = plan ? expertMap[plan.expert_id] : null;
                      const buyer = profileMap[s.user_id];
                      return (
                        <tr key={s.id} className="border-b last:border-0">
                          <td className="p-3">{buyer?.display_name || '-'}</td>
                          <td className="p-3">{plan?.name || '-'}</td>
                          <td className="p-3">
                            {exp ? (
                              <span className="inline-flex items-center gap-2">
                                {exp.name}
                                {exp.role === 'mentor' && <Badge className="bg-mentor text-white text-xs">導師</Badge>}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="p-3">{s.billing_cycle === 'yearly' ? '年' : '月'}</td>
                          <td className="p-3">
                            <Badge variant={s.status === 'active' ? 'default' : 'outline'} className="text-xs">{s.status}</Badge>
                          </td>
                          <td className="p-3">{s.auto_renew ? '是' : '否'}</td>
                          <td className="p-3">{fmtDate(s.started_at)}</td>
                          <td className="p-3">{fmtDate(s.expires_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ====================== 金流明細 ====================== */}
          <TabsContent value="transactions" className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative w-[260px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9 h-9" placeholder="搜尋訂閱者/專家/方案..." value={txSearch} onChange={e => setTxSearch(e.target.value)} />
              </div>
              <Select value={txStatus} onValueChange={(v) => setTxStatus(v as any)}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部狀態</SelectItem>
                  <SelectItem value="paid">已付款</SelectItem>
                  <SelectItem value="refunded">已退款</SelectItem>
                  <SelectItem value="pending">處理中</SelectItem>
                  <SelectItem value="failed">失敗</SelectItem>
                </SelectContent>
              </Select>
              <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={() => {
                  exportCSV(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, [
                    ['時間', '訂閱者', '產品', '專家', '原價', '折扣', '實收', '金流', '狀態', '交易編號'],
                    ...filteredTx.map(r => [
                      fmtDateTime(r.created_at),
                      r.buyer_name, r.product, r.expert_name,
                      r.original_amount || r.amount, r.discount || 0, r.amount,
                      r.provider_label, r.status, r.provider_tx_id || r.id.slice(0, 8),
                    ]),
                  ]);
                }}>
                  <Download className="h-4 w-4 mr-2" />匯出
                </Button>
              </div>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3">時間</th>
                      <th className="p-3">訂閱者</th>
                      <th className="p-3">產品</th>
                      <th className="p-3">專家</th>
                      <th className="p-3 text-right">原價</th>
                      <th className="p-3 text-right">折扣</th>
                      <th className="p-3 text-right">實收</th>
                      <th className="p-3">金流</th>
                      <th className="p-3">狀態</th>
                      <th className="p-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTx.length === 0 ? (
                      <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">無資料</td></tr>
                    ) : filteredTx.map(r => (
                      <tr key={`${r.kind}-${r.id}`} className="border-b last:border-0">
                        <td className="p-3 text-xs whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                        <td className="p-3">{r.buyer_name}</td>
                        <td className="p-3 text-xs">{r.product}</td>
                        <td className="p-3">{r.expert_name}</td>
                        <td className="p-3 text-right">{fmtMoney(r.original_amount || r.amount)}</td>
                        <td className="p-3 text-right text-muted-foreground">{r.discount ? `-${fmtMoney(r.discount)}` : '-'}</td>
                        <td className="p-3 text-right font-medium">{fmtMoney(r.amount)}</td>
                        <td className="p-3"><Badge variant="outline" className="text-xs">{r.provider_label}</Badge></td>
                        <td className="p-3">
                          <Badge
                            variant={r.status === 'paid' ? 'default' : r.status === 'refunded' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {r.status === 'paid' ? '已付款' : r.status === 'refunded' ? '已退款' : r.status === 'pending' ? '處理中' : r.status === 'failed' ? '失敗' : r.status}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {r.kind === 'card' && r.status === 'paid' && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-company hover:bg-company/10"
                              onClick={() => { setRefundingTx(r); setRefundReason(''); }}>
                              <Undo2 className="h-3.5 w-3.5 mr-1" />退款
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ====================== 專家分潤對帳 ====================== */}
          <TabsContent value="payouts" className="mt-4 space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">本期應分給每位專家的金額（從 revenue_splits 聚合，不含退款）</p>
              <Button variant="outline" size="sm" onClick={() => {
                exportCSV(`expert-payouts-${new Date().toISOString().slice(0, 10)}.csv`, [
                  ['專家', '角色', '筆數', '毛收', '折扣', '淨收', '平台', '專家應分'],
                  ...expertPayouts.map(p => [
                    p.expert?.name || p.expert_id,
                    p.expert?.role === 'mentor' ? '導師' : '分析師',
                    p.count, p.gross, p.discount, p.net, p.platform, p.expert,
                  ]),
                ]);
              }}>
                <Download className="h-4 w-4 mr-2" />匯出
              </Button>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3 w-8"></th>
                      <th className="p-3">專家</th>
                      <th className="p-3 text-right">筆數</th>
                      <th className="p-3 text-right">毛收</th>
                      <th className="p-3 text-right">折扣</th>
                      <th className="p-3 text-right">淨收</th>
                      <th className="p-3 text-right">平台</th>
                      <th className="p-3 text-right">專家應分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expertPayouts.length === 0 ? (
                      <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">本期尚無專家分潤紀錄</td></tr>
                    ) : expertPayouts.map(p => {
                      const open = expandedExpert === p.expert_id;
                      const detail = splitsByExpert[p.expert_id] || [];
                      return (
                        <>
                          <tr key={p.expert_id} className="border-b cursor-pointer hover:bg-muted/40"
                              onClick={() => setExpandedExpert(open ? null : p.expert_id)}>
                            <td className="p-3">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                            <td className="p-3">
                              <span className="inline-flex items-center gap-2">
                                {p.expert?.name || p.expert_id.slice(0, 8)}
                                {p.expert?.role === 'mentor' && <Badge className="bg-mentor text-white text-xs">導師</Badge>}
                              </span>
                            </td>
                            <td className="p-3 text-right">{p.count}</td>
                            <td className="p-3 text-right">{fmtMoney(p.gross)}</td>
                            <td className="p-3 text-right text-muted-foreground">-{fmtMoney(p.discount)}</td>
                            <td className="p-3 text-right">{fmtMoney(p.net)}</td>
                            <td className="p-3 text-right">{fmtMoney(p.platform)}</td>
                            <td className="p-3 text-right font-medium text-primary">{fmtMoney(p.expert)}</td>
                          </tr>
                          {open && (
                            <tr key={`${p.expert_id}-detail`} className="bg-muted/20">
                              <td colSpan={8} className="p-3">
                                <ScrollArea className="max-h-[320px]">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-left text-muted-foreground">
                                        <th className="p-2">日期</th>
                                        <th className="p-2">方案</th>
                                        <th className="p-2 text-right">毛收</th>
                                        <th className="p-2 text-right">折扣</th>
                                        <th className="p-2 text-right">淨收</th>
                                        <th className="p-2 text-right">平台</th>
                                        <th className="p-2 text-right">專家</th>
                                        <th className="p-2">規則來源</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.map(d => (
                                        <tr key={d.id} className="border-t border-border/40">
                                          <td className="p-2 whitespace-nowrap">{fmtDate(d.created_at)}</td>
                                          <td className="p-2">{planMap[d.plan_id]?.name || '-'}</td>
                                          <td className="p-2 text-right">{fmtMoney(d.gross)}</td>
                                          <td className="p-2 text-right">-{fmtMoney(d.discount)}</td>
                                          <td className="p-2 text-right">{fmtMoney(d.net)}</td>
                                          <td className="p-2 text-right">{fmtMoney(d.platform_amount)}</td>
                                          <td className="p-2 text-right text-primary">{fmtMoney(d.expert_amount)}</td>
                                          <td className="p-2"><Badge variant="outline" className="text-xs">{ruleSourceLabels[d.rule_source] || d.rule_source}</Badge></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </ScrollArea>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ====================== 健檢營收 ====================== */}
          <TabsContent value="checkup" className="mt-4 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="健檢毛收" value={fmtMoney(checkupOverview.gross)} hint={`${checkupOverview.count} 筆`} />
              <StatCard label="健檢折扣" value={fmtMoney(checkupOverview.discount)} />
              <StatCard label="健檢淨收" value={fmtMoney(checkupOverview.net)} variant="primary" />
              <StatCard label="活躍訂閱" value={String(checkupSubs.filter(c => c.status === 'active').length)} />
            </div>

            <Card>
              <CardContent className="p-4 text-xs text-muted-foreground">
                健檢方案規則：平台 100%、專家 0%（不分潤）。所有健檢淨收皆計入平台口袋。
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">健檢月趨勢</CardTitle></CardHeader>
              <CardContent>
                {checkupTrend.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">尚無資料</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={checkupTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} />
                      <Line type="monotone" dataKey="gross" name="毛收" stroke="hsl(var(--company))" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => {
                exportCSV(`checkup-subs-${new Date().toISOString().slice(0, 10)}.csv`, [
                  ['用戶', '方案', '週期', '狀態', '自動續訂', '起始日', '到期日'],
                  ...checkupSubs.map(c => {
                    const buyer = profileMap[c.user_id];
                    const plan = checkupPlanMap[c.plan_id];
                    return [
                      buyer?.display_name || '-',
                      plan?.name || '-',
                      c.billing_cycle === 'yearly' ? '年' : '月',
                      c.status,
                      c.auto_renew ? '是' : '否',
                      fmtDate(c.started_at),
                      fmtDate(c.expires_at),
                    ];
                  }),
                ]);
              }}>
                <Download className="h-4 w-4 mr-2" />匯出健檢訂閱
              </Button>
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3">用戶</th>
                      <th className="p-3">方案</th>
                      <th className="p-3">週期</th>
                      <th className="p-3">狀態</th>
                      <th className="p-3">自動續訂</th>
                      <th className="p-3">起始日</th>
                      <th className="p-3">到期日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkupSubs.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">尚無健檢訂閱</td></tr>
                    ) : checkupSubs.map(c => {
                      const buyer = profileMap[c.user_id];
                      const plan = checkupPlanMap[c.plan_id];
                      return (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="p-3">{buyer?.display_name || '-'}</td>
                          <td className="p-3">{plan?.name || '-'}</td>
                          <td className="p-3">{c.billing_cycle === 'yearly' ? '年' : '月'}</td>
                          <td className="p-3"><Badge variant={c.status === 'active' ? 'default' : 'outline'} className="text-xs">{c.status}</Badge></td>
                          <td className="p-3">{c.auto_renew ? '是' : '否'}</td>
                          <td className="p-3">{fmtDate(c.started_at)}</td>
                          <td className="p-3">{fmtDate(c.expires_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 退款 Dialog */}
        <AlertDialog open={!!refundingTx} onOpenChange={(o) => { if (!o) setRefundingTx(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>確認退款</AlertDialogTitle>
              <AlertDialogDescription>
                將對交易 {refundingTx?.provider_tx_id || refundingTx?.id?.slice(0, 8)} 進行退款，金額 {fmtMoney(refundingTx?.amount || 0)}。
                注意：退款只會更新交易狀態，<strong>不會反沖 revenue_splits 的分潤紀錄</strong>，請於對帳時手動扣除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-2">
              <Label>退款原因</Label>
              <Textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="請填寫退款原因..." rows={3} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleRefund} className="bg-company hover:bg-company/90 text-white">確認退款</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </CompanyLayout>
  );
};

/* ----------------- 子元件 ----------------- */
function StatCard({
  label, value, hint, variant,
}: { label: string; value: string; hint?: string; variant?: 'primary' | 'destructive' }) {
  const valueClass =
    variant === 'destructive' ? 'text-destructive' :
    variant === 'primary' ? 'text-primary' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default CompanyRevenue;
