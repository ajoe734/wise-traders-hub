import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Loader2, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface PerfRow {
  id: string;
  instrument: string;
  symbol: string;
  name: string | null;
  entry_price: number | null;
  current_price: number | null;
  pnl_percent: number | null;
  quantity: number;
  status: string;
}

interface RealizedRow {
  id: string;
  instrument: string;
  entry_price: number | null;
  exit_price: number | null;
  entry_date: string | null;
  exit_date: string | null;
  pnl_percent: number | null;
  status: string;
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

type RealizedPeriod = 'week' | 'month' | 'year';

const AdminPerformance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [realizedRows, setRealizedRows] = useState<RealizedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [realizedLoading, setRealizedLoading] = useState(true);
  const [realizedPeriod, setRealizedPeriod] = useState<RealizedPeriod>('month');
  const [expertId, setExpertId] = useState<string | null>(null);
  const [expertRole, setExpertRole] = useState<string | null>(null);

  const pnlColor = (val: number | null) =>
    val != null && val > 0
      ? 'text-red-600 dark:text-red-400'
      : val != null && val < 0
        ? 'text-green-600 dark:text-green-400'
        : 'text-foreground';

  // 取得 expert_id
  useEffect(() => {
    if (!user) return;
    supabase
      .from('experts')
      .select('id, role')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setExpertId(data.id);
          setExpertRole(data.role);
        }
      });
  }, [user]);

  // ─── 未實現損益：trade_records (open) ───
  useEffect(() => {
    if (!expertId) return;

    const fetchInitial = async () => {
      const { data, error } = await supabase
        .from('trade_records')
        .select('id, instrument, entry_price, current_price, pnl_percent, quantity, status')
        .eq('expert_id', expertId)
        .eq('status', 'open');

      if (!error) {
        setRows(
          (data || []).map(r => {
            const parts = r.instrument.split(' ');
            const symbol = parts[0] || r.instrument;
            const name = parts.slice(1).join(' ') || null;
            return {
              id: r.id,
              instrument: r.instrument,
              symbol,
              name,
              entry_price: r.entry_price ? Number(r.entry_price) : null,
              current_price: r.current_price ? Number(r.current_price) : null,
              pnl_percent: r.pnl_percent ? Number(r.pnl_percent) : null,
              quantity: r.quantity ?? 1,
              status: r.status,
            };
          }),
        );
      }
      setLoading(false);
    };

    fetchInitial();

    // Realtime updates from trade_records
    const channel = supabase
      .channel('admin-perf-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trade_records',
          filter: `expert_id=eq.${expertId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as any;
            if (row.status !== 'open') return;
            const parts = (row.instrument || '').split(' ');
            setRows(prev => [...prev, {
              id: row.id,
              instrument: row.instrument,
              symbol: parts[0] || row.instrument,
              name: parts.slice(1).join(' ') || null,
              entry_price: row.entry_price ? Number(row.entry_price) : null,
              current_price: row.current_price ? Number(row.current_price) : null,
              pnl_percent: row.pnl_percent ? Number(row.pnl_percent) : null,
              status: row.status,
            }]);
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as any;
            if (row.status !== 'open') {
              // Position closed — remove from list
              setRows(prev => prev.filter(r => r.id !== row.id));
            } else {
              setRows(prev => prev.map(r => r.id === row.id ? {
                ...r,
                current_price: row.current_price ? Number(row.current_price) : null,
                pnl_percent: row.pnl_percent ? Number(row.pnl_percent) : null,
              } : r));
            }
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as any;
            setRows(prev => prev.filter(r => r.id !== old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [expertId]);

  // ─── 已實現損益：trade_records (closed = sell/trim) ───
  const fetchRealized = useCallback(async () => {
    if (!expertId) return;
    setRealizedLoading(true);

    const now = new Date();
    let fromDate: Date;
    if (realizedPeriod === 'week') {
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 7);
    } else if (realizedPeriod === 'month') {
      fromDate = new Date(now);
      fromDate.setMonth(now.getMonth() - 1);
    } else {
      fromDate = new Date(now);
      fromDate.setFullYear(now.getFullYear() - 1);
    }

    const { data, error } = await supabase
      .from('trade_records')
      .select('id, instrument, entry_price, exit_price, entry_date, exit_date, pnl_percent, status')
      .eq('expert_id', expertId)
      .eq('status', 'closed')
      .gte('exit_date', fromDate.toISOString())
      .order('exit_date', { ascending: false });

    if (!error) {
      setRealizedRows(data || []);
    }
    setRealizedLoading(false);
  }, [expertId, realizedPeriod]);

  useEffect(() => {
    fetchRealized();
  }, [fetchRealized]);

  // ─── 統計摘要 ───
  const unrealizedSummary = useMemo(() => {
    const totalPct = rows.length > 0
      ? rows.reduce((sum, r) => sum + (r.pnl_percent ?? 0), 0) / rows.length
      : 0;
    return { totalPct, count: rows.length };
  }, [rows]);

  const realizedSummary = useMemo(() => {
    const total = realizedRows.reduce((sum, r) => {
      if (r.entry_price && r.exit_price) {
        return sum + (r.exit_price - r.entry_price);
      }
      return sum;
    }, 0);
    const totalPct = realizedRows.length > 0
      ? realizedRows.reduce((sum, r) => sum + (r.pnl_percent ?? 0), 0) / realizedRows.length
      : 0;
    const winCount = realizedRows.filter(r => (r.pnl_percent ?? 0) > 0).length;
    const winRate = realizedRows.length > 0 ? (winCount / realizedRows.length) * 100 : 0;
    return { total, totalPct, count: realizedRows.length, winRate };
  }, [realizedRows]);

  const fmtPrice = (v: number) => v.toLocaleString();
  const fmtPnl = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
  const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtDate = (d: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
  };

  const periodLabel: Record<RealizedPeriod, string> = {
    week: '近一週',
    month: '近一月',
    year: '近一年',
  };

  // 解析股票代碼與名稱 (instrument 格式: "2330 台積電")
  const parseInstrument = (inst: string) => {
    const parts = inst.split(' ');
    const symbol = parts[0] || inst;
    const name = parts.slice(1).join(' ') || null;
    return { symbol, name };
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">績效總覽</h1>
          <p className="text-muted-foreground text-sm mt-1">
            區分未實現與已實現損益，已實現僅計算賣出與減碼
          </p>
        </div>

        <Tabs defaultValue="unrealized" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 max-w-sm">
            <TabsTrigger value="unrealized" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              未實現損益
            </TabsTrigger>
            <TabsTrigger value="realized" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              已實現損益
            </TabsTrigger>
          </TabsList>

          {/* ═══ 未實現損益 ═══ */}
          <TabsContent value="unrealized" className="space-y-4">
            {/* 摘要卡片 */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">持倉數量</p>
                  <p className="text-2xl font-bold tabular-nums">{unrealizedSummary.count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">平均報酬</p>
                  <p className={cn('text-2xl font-bold tabular-nums', pnlColor(unrealizedSummary.totalPct))}>
                    {unrealizedSummary.count > 0 ? fmtPct(unrealizedSummary.totalPct) : '-'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* 持倉列表 */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">進場價</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">現價</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">報酬</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                            載入中...
                          </td>
                        </tr>
                      ) : rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                            目前無持倉
                          </td>
                        </tr>
                      ) : (
                        rows.map(row => (
                          <tr key={row.id} className="border-b last:border-0">
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
                                value={row.pnl_percent}
                                format={fmtPct}
                                className={pnlColor(row.pnl_percent)}
                              />
                            </td>
                            <td className="text-center p-3">
                              <Badge variant="default" className="text-xs">
                                持有中
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
          </TabsContent>

          {/* ═══ 已實現損益 ═══ */}
          <TabsContent value="realized" className="space-y-4">
            {/* 期間篩選 */}
            <div className="flex items-center gap-2">
              {(['week', 'month', 'year'] as RealizedPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setRealizedPeriod(p)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    realizedPeriod === p
                      ? expertRole === 'mentor'
                        ? 'bg-mentor text-white'
                        : 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {periodLabel[p]}
                </button>
              ))}
            </div>

            {/* 摘要卡片 */}
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">交易筆數</p>
                  <p className="text-2xl font-bold tabular-nums">{realizedSummary.count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">平均報酬</p>
                  <p className={cn('text-2xl font-bold tabular-nums', pnlColor(realizedSummary.totalPct))}>
                    {realizedSummary.count > 0 ? fmtPct(realizedSummary.totalPct) : '-'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">勝率</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {realizedSummary.count > 0 ? `${realizedSummary.winRate.toFixed(0)}%` : '-'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* 已實現交易列表 */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">進場價</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">出場價</th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">報酬</th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">出場日</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realizedLoading ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                            載入中...
                          </td>
                        </tr>
                      ) : realizedRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                            {periodLabel[realizedPeriod]}無已實現交易紀錄
                          </td>
                        </tr>
                      ) : (
                        realizedRows.map(row => {
                          const { symbol, name } = parseInstrument(row.instrument);
                          return (
                            <tr key={row.id} className="border-b last:border-0">
                              <td className="p-3">
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">{name || symbol}</span>
                                  <span className="text-xs text-muted-foreground">{symbol}</span>
                                </div>
                              </td>
                              <td className="text-right p-3 text-sm tabular-nums">
                                {row.entry_price != null ? row.entry_price.toLocaleString() : '-'}
                              </td>
                              <td className="text-right p-3 text-sm tabular-nums">
                                {row.exit_price != null ? row.exit_price.toLocaleString() : '-'}
                              </td>
                              <td className={cn('text-right p-3 text-sm font-medium tabular-nums', pnlColor(row.pnl_percent))}>
                                {row.pnl_percent != null ? fmtPct(row.pnl_percent) : '-'}
                              </td>
                              <td className="text-center p-3 text-sm text-muted-foreground">
                                {fmtDate(row.exit_date)}
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
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
};

export default AdminPerformance;
