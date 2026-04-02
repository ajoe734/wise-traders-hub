import { useState, useEffect, useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, TrendingUp, Users, Download, Repeat } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

const CompanyRevenue = () => {
  const [experts, setExperts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const [{ data: exp }, { data: tx }, { data: subs }] = await Promise.all([
      supabase.from('experts').select('*').order('name'),
      supabase.from('payment_transactions').select('*, payment_providers(display_name)').eq('status', 'paid'),
      supabase.from('member_subscriptions').select('*, expert_plans(expert_id, name, price_monthly)').eq('status', 'active').eq('auto_renew', true),
    ]);
    setExperts(exp || []);
    setTransactions(tx || []);
    setSubscriptions(subs || []);
  };

  // Total revenue from paid transactions
  const totalRevenue = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // MRR from active subscriptions
  const mrr = subscriptions.reduce((sum, s) => sum + (s.expert_plans?.price_monthly || 0), 0);

  // Monthly revenue trend from real transaction data
  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(tx => {
      const d = tx.paid_at ? new Date(tx.paid_at) : new Date(tx.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[key] = (map[key] || 0) + (tx.amount || 0);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }));
  }, [transactions]);

  const [mrrFilter, setMrrFilter] = useState<'all' | 'advisor' | 'mentor'>('all');

  // Analyst MRR bar data with role
  const analystBarData = useMemo(() => {
    const map: Record<string, number> = {};
    subscriptions.forEach(s => {
      const expertId = s.expert_plans?.expert_id;
      if (!expertId) return;
      map[expertId] = (map[expertId] || 0) + (s.expert_plans?.price_monthly || 0);
    });
    return Object.entries(map).map(([expertId, value]) => {
      const expert = experts.find(e => e.id === expertId);
      return { name: expert?.name || expertId.slice(0, 6), value, role: expert?.role || 'advisor' };
    }).sort((a, b) => b.value - a.value);
  }, [subscriptions, experts]);

  const filteredBarData = useMemo(() => {
    if (mrrFilter === 'all') return analystBarData;
    return analystBarData.filter(d => d.role === mrrFilter);
  }, [analystBarData, mrrFilter]);

  const handleExport = () => {
    const headers = ['月份', '營收(NT$)'];
    const rows = monthlyData.map(d => [d.month, d.amount]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">營收數據</h1>
            <p className="text-muted-foreground text-sm mt-1">全平台營收與訂閱數據分析</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />匯出報表
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">總營收</span>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">NT${totalRevenue.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">MRR</span>
                <Repeat className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">NT${mrr.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">{subscriptions.length} 位活躍訂閱</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">總交易筆數</span>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{transactions.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">分析師數</span>
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{experts.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">月營收趨勢</CardTitle></CardHeader>
            <CardContent>
              {monthlyData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">尚無交易數據</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <Tooltip formatter={(v: number) => [`NT$${v.toLocaleString()}`, '營收']} />
                    <Line type="monotone" dataKey="amount" stroke="hsl(var(--company))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">MRR 貢獻</CardTitle>
              <Tabs value={mrrFilter} onValueChange={(v) => setMrrFilter(v as any)}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs px-3 h-6">全部</TabsTrigger>
                  <TabsTrigger value="advisor" className="text-xs px-3 h-6">分析師</TabsTrigger>
                  <TabsTrigger value="mentor" className="text-xs px-3 h-6">實戰導師</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {filteredBarData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">尚無訂閱數據</p>
              ) : (
                <ScrollArea className="w-full" style={{ height: Math.max(160, filteredBarData.length * 44 + 20) > 300 ? 300 : Math.max(160, filteredBarData.length * 44 + 20) }}>
                  <div style={{ height: Math.max(160, filteredBarData.length * 44 + 20) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={filteredBarData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 12 }} className="fill-muted-foreground" tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} className="fill-muted-foreground" width={70} />
                        <Tooltip formatter={(v: number) => [`NT$${v.toLocaleString()}`, 'MRR']} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
                          {filteredBarData.map((entry, i) => (
                            <Cell key={i} fill="hsl(var(--company))" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </CompanyLayout>
  );
};

export default CompanyRevenue;
