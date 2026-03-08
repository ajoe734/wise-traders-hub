import { useState, useEffect, useRef, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface PerformanceRow {
  symbol: string;
  name: string;
  entry_price: number | null;
  current_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  status: string;
}

const POLL_INTERVAL = 30_000;

const AdminPerformance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevPricesRef = useRef<Record<string, number | null>>({});
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down' | null>>({});

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const userId = user.id;

      // 1. 取得該分析師所有交易訊號
      const { data: signals, error: sigErr } = await supabase
        .from('trade_signals')
        .select('id, symbol, name, entry_price, exit_price, pnl, pnl_percent, status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (sigErr) throw new Error(sigErr.message);
      if (!signals || signals.length === 0) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }

      // 2. 取得開倉部位的即時績效 (由 Python 腳本更新，以 signal_id 為 key)
      const openSignalIds = signals.filter(s => s.status === 'open').map(s => s.id);
      let perfMap = new Map<number, { current_price: number | null; pnl: number | null; pnl_percent: number | null }>();

      if (openSignalIds.length > 0) {
        const { data: perfs } = await supabase
          .from('user_performances')
          .select('signal_id, current_price, pnl, pnl_percent')
          .eq('user_id', userId)
          .in('signal_id', openSignalIds);

        perfMap = new Map((perfs || []).map(p => [p.signal_id, p]));
      }

      // 3. 合併資料
      const merged: PerformanceRow[] = signals.map(sig => {
        const isOpen = sig.status === 'open';
        const perf = isOpen ? perfMap.get(sig.id) : null;

        return {
          symbol: sig.symbol,
          name: sig.name || '-',
          entry_price: sig.entry_price,
          current_price: isOpen ? (perf?.current_price ?? null) : (sig.exit_price ?? null),
          pnl: isOpen ? (perf?.pnl ?? null) : (sig.pnl ?? null),
          pnl_percent: isOpen ? (perf?.pnl_percent ?? null) : (sig.pnl_percent ?? null),
          status: sig.status || 'open',
        };
      });

      // 4. 閃爍動畫偵測
      const newFlash: Record<string, 'up' | 'down' | null> = {};
      for (const row of merged) {
        const prev = prevPricesRef.current[row.symbol];
        if (prev != null && row.current_price != null && prev !== row.current_price) {
          newFlash[row.symbol] = row.current_price > prev ? 'up' : 'down';
        }
      }
      const priceMap: Record<string, number | null> = {};
      for (const row of merged) priceMap[row.symbol] = row.current_price;
      prevPricesRef.current = priceMap;

      setRows(merged);
      setError(null);

      if (Object.keys(newFlash).length > 0) {
        setFlashMap(newFlash);
        setTimeout(() => setFlashMap({}), 700);
      }
    } catch (e: any) {
      setError(e.message || '無法連線');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  const statusLabel = (s: string) => {
    switch (s) {
      case 'open': return '持有中';
      case 'closed': return '已停損';
      default: return s;
    }
  };

  const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' => {
    switch (s) {
      case 'open': return 'default';
      case 'closed': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">績效總覽</h1>
            <p className="text-muted-foreground text-sm mt-1">
              即時績效數據（每 30 秒自動更新）
            </p>
          </div>
          {loading && rows.length > 0 && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            連線失敗：{error}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">進場價</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">現價</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">損益</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">績效</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                        載入中...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">
                        尚無績效資料
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, idx) => {
                      const flash = flashMap[row.symbol];
                      const pnlPositive = row.pnl != null && row.pnl > 0;
                      const pnlNegative = row.pnl != null && row.pnl < 0;
                      const pnlColor = pnlPositive
                        ? 'text-red-600 dark:text-red-400'
                        : pnlNegative
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-foreground';

                      return (
                        <tr key={`${row.symbol}-${idx}`} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{row.name}</span>
                              <span className="text-xs text-muted-foreground">{row.symbol}</span>
                            </div>
                          </td>
                          <td className="text-right p-3 text-sm tabular-nums">
                            {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                          </td>
                          <td
                            className={cn(
                              'text-right p-3 text-sm font-medium tabular-nums transition-colors duration-700',
                              flash === 'up' && 'bg-red-500/20 text-red-600 dark:text-red-400',
                              flash === 'down' && 'bg-green-500/20 text-green-600 dark:text-green-400',
                            )}
                          >
                            {row.current_price != null ? row.current_price.toLocaleString() : '-'}
                          </td>
                          <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor)}>
                            {row.pnl != null
                              ? `${row.pnl > 0 ? '+' : ''}${row.pnl.toLocaleString()}`
                              : '-'}
                          </td>
                          <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor)}>
                            {row.pnl_percent != null
                              ? `${row.pnl_percent > 0 ? '+' : ''}${row.pnl_percent.toFixed(2)}%`
                              : '-'}
                          </td>
                          <td className="text-center p-3">
                            <Badge variant={statusVariant(row.status)} className="text-xs">
                              {statusLabel(row.status)}
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
