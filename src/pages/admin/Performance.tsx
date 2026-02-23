import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole } from '@/types';
import { cn } from '@/lib/utils';
import { Upload, TrendingUp, TrendingDown, BarChart3, RefreshCw } from 'lucide-react';

const AdminPerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  // Mock performance summary
  const perfSummary = {
    cumulativeReturn: 680,
    annualReturn: 42.5,
    maxDrawdown: -18.3,
    sharpe: 2.1,
    winRate: 68.5,
    totalTrades: 441,
    profitFactor: 2.8,
    avgHoldDays: 2.3,
  };

  // Mock recent trades
  const recentTrades = [
    { id: '1', date: '2025-02-20', instrument: '2330 台積電', action: '買進', entryPrice: '890', exitPrice: '915', pnl: '+2.8%', status: '已平倉' },
    { id: '2', date: '2025-02-18', instrument: '3661 世芯-KY', action: '買進', entryPrice: '2100', exitPrice: '-', pnl: '+1.2%', status: '持有中' },
    { id: '3', date: '2025-02-17', instrument: '2603 長榮', action: '買進', entryPrice: '185', exitPrice: '178', pnl: '-3.8%', status: '已停損' },
    { id: '4', date: '2025-02-15', instrument: '2454 聯發科', action: '買進', entryPrice: '1180', exitPrice: '1250', pnl: '+5.9%', status: '已平倉' },
    { id: '5', date: '2025-02-14', instrument: '6505 台塑化', action: '買進', entryPrice: '72', exitPrice: '68.5', pnl: '-4.9%', status: '已停損' },
  ];

  const metricCards = [
    { label: '累計報酬率', value: `${perfSummary.cumulativeReturn}%`, icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '年化報酬率', value: `${perfSummary.annualReturn}%`, icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '最大回撤', value: `${perfSummary.maxDrawdown}%`, icon: TrendingDown, color: 'text-red-600 dark:text-red-400' },
    { label: 'Sharpe Ratio', value: perfSummary.sharpe.toFixed(1), icon: BarChart3, color: 'text-foreground' },
    { label: '勝率', value: `${perfSummary.winRate}%`, icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '總交易數', value: perfSummary.totalTrades, icon: BarChart3, color: 'text-foreground' },
    { label: '獲利因子', value: perfSummary.profitFactor.toFixed(1), icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
    { label: '平均持有天數', value: `${perfSummary.avgHoldDays} 天`, icon: BarChart3, color: 'text-foreground' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">績效管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理您的策略績效數據</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              同步數據
            </Button>
            <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
              <Upload className="h-4 w-4 mr-2" />
              上傳交易紀錄
            </Button>
          </div>
        </div>

        {/* Performance Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {metricCards.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{metric.label}</span>
                  <metric.icon className={cn("h-4 w-4", metric.color)} />
                </div>
                <div className={cn("text-xl font-bold", metric.color)}>
                  {metric.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent Trades */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">近期交易紀錄</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">日期</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">進場價</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">出場價</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">損益</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((trade) => (
                    <tr key={trade.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 text-sm text-muted-foreground">{trade.date}</td>
                      <td className="p-3 text-sm font-medium">{trade.instrument}</td>
                      <td className="p-3 text-sm">{trade.entryPrice}</td>
                      <td className="p-3 text-sm">{trade.exitPrice}</td>
                      <td className={cn(
                        "p-3 text-sm font-medium",
                        trade.pnl.startsWith('+') ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      )}>
                        {trade.pnl}
                      </td>
                      <td className="p-3">
                        <Badge variant={
                          trade.status === '已平倉' ? 'secondary' :
                          trade.status === '持有中' ? 'default' : 'destructive'
                        } className="text-xs">
                          {trade.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
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
