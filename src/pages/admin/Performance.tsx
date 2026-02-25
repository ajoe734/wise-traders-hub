import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

const AdminPerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [expertSlug]);

  const fetchData = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (exp) {
      // Fetch performance via DB function
      const { data: perfData } = await supabase.rpc('calculate_expert_performance', { _expert_id: exp.id });
      setPerf(perfData);

      // Fetch recent trades
      const { data: t } = await supabase.from('trade_records').select('*').eq('expert_id', exp.id).order('created_at', { ascending: false }).limit(10);
      setTrades(t || []);
    }
    setLoading(false);
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  const summary = perf || { cumulative_return: 0, win_rate: 0, max_drawdown: 0, profit_factor: 0, avg_hold_days: 0, total_trades: 0 };

  const metricCards = [
    { label: '累計報酬率', value: `${summary.cumulative_return}%`, icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '最大回撤', value: `${summary.max_drawdown}%`, icon: TrendingDown, color: 'text-red-600 dark:text-red-400' },
    { label: '勝率', value: `${summary.win_rate}%`, icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '總交易數', value: summary.total_trades, icon: BarChart3, color: 'text-foreground' },
    { label: '獲利因子', value: summary.profit_factor, icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '平均持有天數', value: `${summary.avg_hold_days} 天`, icon: BarChart3, color: 'text-foreground' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">績效總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">系統根據訊號自動計算的績效數據（唯讀）</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {metricCards.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{metric.label}</span>
                  <metric.icon className={cn("h-4 w-4", metric.color)} />
                </div>
                <div className={cn("text-xl font-bold", metric.color)}>{metric.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-sm">近期交易紀錄</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">進場價</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">現價/出場價</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">損益</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">尚無交易紀錄</td></tr>
                  ) : (
                    trades.map((trade) => (
                      <tr key={trade.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 text-sm font-medium">{trade.instrument}</td>
                        <td className="p-3 text-sm">{trade.entry_price || '-'}</td>
                        <td className="p-3 text-sm">
                          {trade.status === 'open' ? (trade.current_price || '-') : (trade.exit_price || '-')}
                        </td>
                        {(() => {
                          // Calculate P&L as price difference
                          const currentOrExit = trade.status === 'open' ? trade.current_price : trade.exit_price;
                          const pnl = currentOrExit && trade.entry_price
                            ? Number((currentOrExit - trade.entry_price).toFixed(2))
                            : null;
                          return (
                            <td className={cn("p-3 text-sm font-medium", pnl != null && pnl > 0 ? "text-green-600 dark:text-green-400" : pnl != null && pnl < 0 ? "text-red-600 dark:text-red-400" : "")}>
                              {pnl != null ? `${pnl > 0 ? '+' : ''}${pnl}` : '-'}
                            </td>
                          );
                        })()}
                        <td className="p-3">
                          <Badge variant={trade.status === 'open' ? 'default' : trade.status === 'closed' ? 'secondary' : 'destructive'} className="text-xs">
                            {trade.status === 'open' ? '持有中' : trade.status === 'closed' ? '已平倉' : '已停損'}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminPerformance;
