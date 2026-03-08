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

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [perfRes, sigRes] = await Promise.all([
      supabase
        .from('user_performances')
        .select('signal_id, symbol, name, entry_price, current_price, pnl, pnl_percent')
        .eq('user_id', user.id),
      supabase
        .from('trade_signals')
        .select('id, status')
        .eq('user_id', user.id),
    ]);

    if (!perfRes.error) {
      const statusMap = new Map<number, string>();
      (sigRes.data || []).forEach(s => statusMap.set(s.id, s.status || 'open'));

      const mapped: PerfRow[] = (perfRes.data || []).map(p => ({
        ...p,
        status: statusMap.get(p.signal_id) || 'open',
      }));

      // Flash detection
      const changedIds: number[] = [];
      for (const row of mapped) {
        const prev = prevDataRef.current.get(row.signal_id);
        if (prev && (prev.current_price !== row.current_price || prev.pnl !== row.pnl)) {
          changedIds.push(row.signal_id);
        }
      }

      setRows(mapped);
      const map = new Map<number, PerfRow>();
      mapped.forEach(r => map.set(r.signal_id, r));
      prevDataRef.current = map;
      setError(null);

      if (changedIds.length > 0) applyFlash(changedIds);
    }
    setLoading(false);
  }, [user, applyFlash]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30_000);
    return () => clearInterval(timer);
  }, [fetchData]);

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
        </div>


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
                      <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">
                        目前無倉位
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
                          <td className="text-center p-3">
                            <Badge
                              variant={row.status === 'closed' ? 'destructive' : 'default'}
                              className="text-xs"
                            >
                              {row.status === 'closed' ? '已停損' : '持倉中'}
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
