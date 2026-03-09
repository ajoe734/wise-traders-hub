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

/* ─── 數字漸變元件 ─── */
function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number | null;
  format: (v: number) => string;
  className?: string;
}) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev == null || value == null || prev === value) return;
    setFlash(value > prev ? 'up' : 'down');
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [value]);

  if (value == null) return <span className={className}>-</span>;

  return (
    <span
      className={cn(
        className,
        'transition-colors duration-300',
        flash === 'up' && 'text-red-500 dark:text-red-400',
        flash === 'down' && 'text-green-500 dark:text-green-400',
      )}
    >
      {format(value)}
    </span>
  );
}

const AdminPerformance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(true);

  const pnlColor = (val: number | null) =>
    val != null && val > 0
      ? 'text-red-600 dark:text-red-400'
      : val != null && val < 0
        ? 'text-green-600 dark:text-green-400'
        : 'text-foreground';

  // 初始載入 + Realtime 訂閱
  useEffect(() => {
    if (!user) return;

    // 首次載入
    const fetchInitial = async () => {
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

        setRows(
          (perfRes.data || []).map(p => ({
            ...p,
            status: statusMap.get(p.signal_id) || 'open',
          })),
        );
      }
      setLoading(false);
    };

    fetchInitial();

    // Realtime 訂閱 user_performances
    const channel = supabase
      .channel('admin-perf-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_performances',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new as any;
            setRows(prev => {
              const idx = prev.findIndex(r => r.signal_id === row.signal_id);
              const updated: PerfRow = {
                signal_id: row.signal_id,
                symbol: row.symbol,
                name: row.name,
                entry_price: row.entry_price,
                current_price: row.current_price,
                pnl: row.pnl,
                pnl_percent: row.pnl_percent,
                status: idx >= 0 ? prev[idx].status : 'open',
              };
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updated;
                return next;
              }
              return [...prev, updated];
            });
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as any;
            setRows(prev => prev.filter(r => r.signal_id !== old.signal_id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fmtPrice = (v: number) => v.toLocaleString();
  const fmtPnl = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
  const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

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
                        目前無持倉
                      </td>
                    </tr>
                  ) : (
                    rows.map(row => (
                      <tr key={row.signal_id} className="border-b last:border-0">
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{row.name || '-'}</span>
                            <span className="text-xs text-muted-foreground">{row.symbol}</span>
                          </div>
                        </td>
                        <td className="text-right p-3 text-sm tabular-nums">
                          {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                        </td>
                        <td className="text-right p-3 text-sm font-medium tabular-nums">
                          <AnimatedNumber value={row.current_price} format={fmtPrice} />
                        </td>
                        <td className="text-right p-3 text-sm font-medium tabular-nums">
                          <AnimatedNumber
                            value={row.pnl}
                            format={fmtPnl}
                            className={pnlColor(row.pnl)}
                          />
                        </td>
                        <td className="text-right p-3 text-sm font-medium tabular-nums">
                          <AnimatedNumber
                            value={row.pnl_percent}
                            format={fmtPct}
                            className={pnlColor(row.pnl_percent)}
                          />
                        </td>
                        <td className="text-center p-3">
                          <Badge
                            variant={row.status === 'closed' ? 'destructive' : 'default'}
                            className="text-xs"
                          >
                            {row.status === 'closed' ? '已停損' : '持有中'}
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
