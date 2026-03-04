import { useState, useEffect, useMemo } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, TrendingUp, Users, Download, Repeat } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

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
      supabase.from('member_subscriptions').select('*, expert_plans(expert_id, name, price_monthly)').eq('status', 'active'),
    ]);
    setExperts(exp || []);
    setTransactions(tx || []);
    setSubscriptions(subs || []);
  };

  const totalRevenue = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // MRR from active subscriptions
  const mrr = subscriptions.reduce((sum, s) => sum + (s.expert_plans?.price_monthly || 0), 0);

  // Monthly revenue trend
  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(tx => {
      if (!tx.paid_at && !tx.created_at) return;
      const d = new Date(tx.paid_at || tx.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[key] = (map[key] || 0) + (tx.amount || 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
  }, [transactions]);

  // Analyst revenue pie
  const analystPieData = useMemo(() => {
    const map: Record<string, number> = {};
    subscriptions.forEach(s => {
      const expertId = s.expert_plans?.expert_id;
      if (!expertId) return;
      map[expertId] = (map[expertId] || 0) + (s.expert_plans?.price_monthly || 0);
    });
    return Object.entries(map).map(([expertId, value]) => {
      const expert = experts.find(e => e.id === expertId);
      return { name: expert?.name || expertId.slice(0, 6), value };
    }).sort((a, b) => b.value - a.value);
  }, [subscriptions, experts]);

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
            <CardHeader><CardTitle className="text-base">分析師 MRR 貢獻</CardTitle></CardHeader>
            <CardContent>
              {analystPieData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">尚無訂閱數據</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={analystPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {analystPieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`NT$${v.toLocaleString()}`, 'MRR']} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Analyst table */}
        <Card>
          <CardHeader><CardTitle className="text-base">分析師一覽</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">分析師</th>
                  <th className="p-4">角色</th>
                  <th className="p-4">狀態</th>
                </tr>
              </thead>
              <tbody>
                {experts.length === 0 ? (
                  <tr><td colSpan={3} className="p-8 text-center text-muted-foreground text-sm">尚無分析師</td></tr>
                ) : (
                  experts.map(exp => (
                    <tr key={exp.id} className="border-b last:border-0">
                      <td className="p-4 font-medium text-sm">{exp.name}</td>
                      <td className="p-4">
                        <Badge variant={exp.role === 'advisor' ? 'default' : 'secondary'} className="text-xs">
                          {exp.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <Badge variant={exp.status === 'active' ? 'outline' : 'destructive'} className="text-xs">
                          {exp.status === 'active' ? '啟用中' : '已停用'}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyRevenue;
