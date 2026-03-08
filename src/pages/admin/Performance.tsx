import { useState, useEffect, useRef, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface PerfRow {
  signal_id: number;
  symbol: string;
  name: string | null;
  entry_price: number | null;
  current_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  status: string | null;
}

const AdminPerformance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flashSet, setFlashSet] = useState<Set<number>>(new Set());
  const prevDataRef = useRef<Map<number, PerfRow>>(new Map());

  const applyFlash = useCallback((changedIds: number[]) => {
    if (changedIds.length === 0) return;
    setFlashSet(new Set(changedIds));
    setTimeout(() => setFlashSet(new Set()), 700);
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      const { data, error: err } = await supabase
        .from('user_performances')
        .select('signal_id, symbol, name, entry_price, current_price, pnl, pnl_percent, status')
        .eq('user_id', user.id);

      if (err) {
        setError(err.message);
      } else {
        const mapped = (data || []) as PerfRow[];
        setRows(mapped);
        const map = new Map<number, PerfRow>();
        mapped.forEach(r => map.set(r.signal_id, r));
        prevDataRef.current = map;
        setError(null);
      }
      setLoading(false);
    };

    fetchData();
  }, [user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('perf-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_performances',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as PerfRow;
          const prev = prevDataRef.current.get(updated.signal_id);
          const changed =
            !prev ||
            prev.current_price !== updated.current_price ||
            prev.pnl !== updated.pnl;

          setRows(current => {
            const exists = current.some(r => r.signal_id === updated.signal_id);
            if (exists) {
              return current.map(r => r.signal_id === updated.signal_id ? updated : r);
            }
            return [...current, updated];
          });

          prevDataRef.current.set(updated.signal_id, updated);

          if (changed) {
            applyFlash([updated.signal_id]);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_performances',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const inserted = payload.new as PerfRow;
          setRows(current => {
            if (current.some(r => r.signal_id === inserted.signal_id)) return current;
            return [...current, inserted];
          });
          prevDataRef.current.set(inserted.signal_id, inserted);
          applyFlash([inserted.signal_id]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, applyFlash]);

  const pnlColor = (val: number | null) =>
    val != null && val > 0
      ? 'text-red-600 dark:text-red-400'
      : val != null && val < 0
        ? 'text-green-600 dark:text-green-400'
        : 'text-foreground';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">績效總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">
            即時績效數據（Realtime 自動更新）
          </p>
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
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                        載入中...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                        尚無績效資料
                      </td>
                    </tr>
                  ) : (
                    rows.map(row => {
                      const isFlashing = flashSet.has(row.signal_id);
                      return (
                        <tr
                          key={row.signal_id}
                          className={cn(
                            'border-b last:border-0 transition-colors',
                            isFlashing && 'animate-pulse bg-accent/30'
                          )}
                        >
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{row.name || '-'}</span>
                              <span className="text-xs text-muted-foreground">{row.symbol}</span>
                            </div>
                          </td>
                          <td className="text-right p-3 text-sm tabular-nums">
                            {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                          </td>
                          <td className={cn(
                            'text-right p-3 text-sm font-medium tabular-nums',
                            isFlashing && 'text-primary'
                          )}>
                            {row.current_price != null ? row.current_price.toLocaleString() : '-'}
                          </td>
                          <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor(row.pnl))}>
                            {row.pnl != null
                              ? `${row.pnl > 0 ? '+' : ''}${row.pnl.toLocaleString()}`
                              : '-'}
                          </td>
                          <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor(row.pnl_percent))}>
                            {row.pnl_percent != null
                              ? `${row.pnl_percent > 0 ? '+' : ''}${row.pnl_percent.toFixed(2)}%`
                              : '-'}
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
