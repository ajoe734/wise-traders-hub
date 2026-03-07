import { useParams } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

const POLL_INTERVAL = 30_000; // 30 seconds

const AdminPerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [expert, setExpert] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [tradePeriod, setTradePeriod] = useState<'week' | 'month' | 'year'>('week');
  const [loading, setLoading] = useState(true);
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; change: number; changePercent: number }>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchData();
  }, [expertSlug]);

  const fetchData = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data: exp } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    setExpert(exp);
    if (exp) {
      const { data: perfData } = await supabase.rpc('calculate_expert_performance', { _expert_id: exp.id });
      setPerf(perfData);
      const { data: t } = await supabase.from('trade_records').select('*').eq('expert_id', exp.id).order('created_at', { ascending: false });
      setTrades(t || []);
    }
    setLoading(false);
  };

  // Fetch current prices from DB for open trades
  const refreshOpenPrices = useCallback(async () => {
    const openTrades = trades.filter(t => t.status === 'open');
    if (openTrades.length === 0) return;

    const uniqueCodes = [...new Set(openTrades.map(t => {
      const match = t.instrument?.match(/^(\d{4})/);
      return match ? match[1] : null;
    }).filter(Boolean))] as string[];

    if (uniqueCodes.length === 0) return;

    const { data } = await supabase
      .from('current_prices')
      .select('*')
      .in('symbol', uniqueCodes);

    if (data) {
      const prices: Record<string, { price: number; change: number; changePercent: number }> = {};
      for (const row of data) {
        const price = Number(row.price);
        const changePercent = Number(row.change_percent || 0);
        const change = changePercent !== 0 ? price * changePercent / (100 + changePercent) : 0;
        prices[row.symbol] = { price, change: Number(change.toFixed(2)), changePercent };
      }
      setLivePrices(prices);
      setLastUpdated(new Date());
    }
  }, [trades]);

  // Subscribe to Realtime for open trade prices
  useEffect(() => {
    const hasOpenTrades = trades.some(t => t.status === 'open');
    if (!hasOpenTrades) return;

    refreshOpenPrices();

    const channel = supabase
      .channel('perf-current-prices')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'current_prices',
      }, (payload) => {
        const row = payload.new as any;
        const price = Number(row.price);
        const changePercent = Number(row.change_percent || 0);
        const change = changePercent !== 0 ? price * changePercent / (100 + changePercent) : 0;
        setLivePrices(prev => ({
          ...prev,
          [row.symbol]: { price, change: Number(change.toFixed(2)), changePercent },
        }));
        setLastUpdated(new Date());
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [trades, refreshOpenPrices]);

  const getLivePrice = (trade: any) => {
    const match = trade.instrument?.match(/^(\d{4})/);
    if (!match) return null;
    return livePrices[match[1]] || null;
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;

  const summary = perf || { cumulative_return: 0, win_rate: 0, max_drawdown: 0, profit_factor: 0, avg_hold_days: 0, total_trades: 0 };

  const getFilteredTrades = () => {
    const now = new Date();
    let cutoff: Date;
    if (tradePeriod === 'week') {
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (tradePeriod === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      cutoff = new Date(now.getFullYear(), 0, 1);
    }
    return trades.filter(t => new Date(t.created_at) >= cutoff);
  };

  const filteredTrades = getFilteredTrades();
  const hasOpenTrades = trades.some(t => t.status === 'open');

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
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">交易紀錄</h3>
                {hasOpenTrades && (
                  <span className="text-[10px] text-muted-foreground">
                    {lastUpdated ? `⚡ ${lastUpdated.toLocaleTimeString('zh-TW')} 更新` : '⚡ 即時報價載入中...'}
                  </span>
                )}
              </div>
              <Tabs value={tradePeriod} onValueChange={(v) => setTradePeriod(v as any)}>
                <TabsList className="h-8">
                  <TabsTrigger value="week" className="text-xs px-3 h-7">本週</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-3 h-7">本月</TabsTrigger>
                  <TabsTrigger value="year" className="text-xs px-3 h-7">本年</TabsTrigger>
                </TabsList>
              </Tabs>
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
                  {filteredTrades.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">此期間尚無交易紀錄</td></tr>
                  ) : (
                    filteredTrades.map((trade) => {
                      const live = trade.status === 'open' ? getLivePrice(trade) : null;
                      const displayPrice = live ? live.price : (trade.status === 'open' ? trade.current_price : trade.exit_price);
                      const livePnl = live && trade.entry_price ? Number(((live.price - trade.entry_price) / trade.entry_price * 100).toFixed(2)) : null;
                      const pnl = livePnl ?? (trade.pnl_percent != null ? Number(trade.pnl_percent) : null);
                      return (
                      <tr key={trade.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 text-sm font-medium">{trade.instrument}</td>
                        <td className="p-3 text-sm">{trade.entry_price || '-'}</td>
                        <td className="p-3 text-sm">
                          {displayPrice || '-'}
                          {live && <span className="ml-1 text-[10px] text-muted-foreground">⚡</span>}
                        </td>
                        <td className={cn("p-3 text-sm font-medium", pnl != null && pnl > 0 ? "text-green-600 dark:text-green-400" : pnl != null && pnl < 0 ? "text-red-600 dark:text-red-400" : "")}>
                          {pnl != null ? `${pnl > 0 ? '+' : ''}${pnl}%` : '-'}
                        </td>
                        <td className="p-3">
                          <Badge variant={trade.status === 'open' ? 'default' : trade.status === 'closed' ? 'secondary' : 'destructive'} className="text-xs">
                            {trade.status === 'open' ? '持有中' : trade.status === 'closed' ? '已平倉' : '已停損'}
                          </Badge>
                        </td>
                      </tr>
                      );
                    })
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
