import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, TrendingUp, ArrowUpRight, Users, Download } from 'lucide-react';

const CompanyRevenue = () => {
  const [experts, setExperts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: exp } = await supabase.from('experts').select('*').order('name');
    setExperts(exp || []);
    const { data: tx } = await supabase.from('payment_transactions').select('*').eq('status', 'paid');
    setTransactions(tx || []);
  };

  const totalRevenue = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">營收數據</h1>
            <p className="text-muted-foreground text-sm mt-1">全平台營收與訂閱數據分析</p>
          </div>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />匯出報表
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
