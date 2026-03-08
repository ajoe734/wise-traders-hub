import { useParams } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface PerformanceRow {
  symbol: string;
  name: string;
  entry_price: number | null;
  current_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  status: string;
}

const API_URL = 'https://3a0fc45831af8f.lhr.life/get_all_performance';
const POLL_INTERVAL = 30_000;

const AdminPerformance = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track previous current_price per symbol for flash animation
  const prevPricesRef = useRef<Record<string, number | null>>({});
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down' | null>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PerformanceRow[] = await res.json();

      // Detect price changes for flash
      const newFlash: Record<string, 'up' | 'down' | null> = {};
      for (const row of json) {
        const prev = prevPricesRef.current[row.symbol];
        if (prev != null && row.current_price != null && prev !== row.current_price) {
          newFlash[row.symbol] = row.current_price > prev ? 'up' : 'down';
        }
      }

      // Update prev prices
      const priceMap: Record<string, number | null> = {};
      for (const row of json) {
        priceMap[row.symbol] = row.current_price;
      }
      prevPricesRef.current = priceMap;

      setRows(json);
      setError(null);

      if (Object.keys(newFlash).length > 0) {
        setFlashMap(newFlash);
        // Clear flash after animation
        setTimeout(() => setFlashMap({}), 700);
      }
    } catch (e: any) {
      setError(e.message || '無法連線');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  const statusLabel = (s: string) => {
    switch (s) {
      case 'open': return '持有中';
      case 'closed': return '已平倉';
      case 'stopped': return '已停損';
      default: return s;
    }
  };

  const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' => {
    switch (s) {
      case 'open': return 'default';
      case 'closed': return 'secondary';
      case 'stopped': return 'destructive';
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
                    rows.map((row) => {
                      const flash = flashMap[row.symbol];
                      const pnlPositive = row.pnl != null && row.pnl > 0;
                      const pnlNegative = row.pnl != null && row.pnl < 0;
                      // Taiwan convention: red = up, green = down
                      const pnlColor = pnlPositive
                        ? 'text-red-600 dark:text-red-400'
                        : pnlNegative
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-foreground';

                      return (
                        <tr key={row.symbol} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          {/* 標的 */}
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{row.symbol}</span>
                              <span className="text-xs text-muted-foreground">{row.name || '-'}</span>
                            </div>
                          </td>

                          {/* 進場價 */}
                          <td className="text-right p-3 text-sm tabular-nums">
                            {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                          </td>

                          {/* 現價 with flash */}
                          <td
                            className={cn(
                              'text-right p-3 text-sm font-medium tabular-nums transition-colors duration-700',
                              flash === 'up' && 'bg-red-500/20 text-red-600 dark:text-red-400',
                              flash === 'down' && 'bg-green-500/20 text-green-600 dark:text-green-400',
                            )}
                          >
                            {row.current_price != null ? row.current_price.toLocaleString() : '-'}
                          </td>

                          {/* 損益 */}
                          <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor)}>
                            {row.pnl != null
                              ? `${row.pnl > 0 ? '+' : ''}${row.pnl.toLocaleString()}`
                              : '-'}
                          </td>

                          {/* 績效 */}
                          <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor)}>
                            {row.pnl_percent != null
                              ? `${row.pnl_percent > 0 ? '+' : ''}${row.pnl_percent.toFixed(2)}%`
                              : '-'}
                          </td>

                          {/* 狀態 */}
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
