import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  PerfRow,
  RealizedRow,
  CapitalStatus,
  RealizedPeriod,
} from '@/pages/_adminPerformance/types';

/**
 * 集中管理 admin/Performance 頁所需資料：
 * - 解析 expertSlug → expertId / expertRole / expertOwnerUserId
 * - 起始資金 / 累計報酬 / 平均報酬（calculate_expert_performance RPC）
 * - 未實現持倉 rows（trade_records + trade_signals + user_performances + current_prices fallback）
 * - 已實現 realizedRows（period 篩選）
 * - 3 個 realtime channel：trade_records summary、user_performances、trade_records detail
 *
 * 行為與重構前 1:1 等價，僅將 5 個 useEffect / 多個 setState 收斂到單一 hook。
 */
export function useAdminPerformanceData(expertSlug: string | undefined) {
  const [expertId, setExpertId] = useState<string | null>(null);
  const [expertOwnerUserId, setExpertOwnerUserId] = useState<string | null>(null);
  const [expertRole, setExpertRole] = useState<string | null>(null);
  const [capital, setCapital] = useState<CapitalStatus | null>(null);
  const [totalPnlPercent, setTotalPnlPercent] = useState<number | null>(null);
  const [avgPnlPercent, setAvgPnlPercent] = useState<number | null>(null);
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [realizedRows, setRealizedRows] = useState<RealizedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [realizedLoading, setRealizedLoading] = useState(true);
  const [realizedPeriod, setRealizedPeriod] = useState<RealizedPeriod>('month');

  // ─── 1. expert 基本資料（支援 company_admin 代管） ───
  useEffect(() => {
    if (!expertSlug) {
      setLoading(false);
      setRealizedLoading(false);
      return;
    }
    supabase
      .from('experts')
      .select('id, role, user_id')
      .eq('slug', expertSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExpertId(data.id);
          setExpertRole(data.role);
          setExpertOwnerUserId(data.user_id);
        } else {
          setLoading(false);
          setRealizedLoading(false);
        }
      });
  }, [expertSlug]);

  // ─── 2. 起始資金 RPC ───
  useEffect(() => {
    if (!expertId) return;
    supabase
      .rpc('get_expert_capital_status' as any, { _expert_id: expertId })
      .then(({ data }) => {
        if (data) setCapital(data as any);
      });
  }, [expertId]);

  // ─── 3. 總報酬率 / 平均報酬 + realtime ───
  const fetchPerfStats = useCallback(async (eid: string) => {
    const { data } = await supabase.rpc('calculate_expert_performance', { _expert_id: eid });
    if (data) {
      const d = data as any;
      const totalRet = d.total_return_pct ?? 0;
      setTotalPnlPercent(Number(totalRet));
      setAvgPnlPercent(d.avg_pnl_pct != null ? Number(d.avg_pnl_pct) : 0);
    }
  }, []);

  useEffect(() => {
    if (!expertId) return;
    fetchPerfStats(expertId);

    const channel = supabase
      .channel('admin-perf-trade-records-summary')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_records', filter: `expert_id=eq.${expertId}` },
        () => { fetchPerfStats(expertId); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [expertId, fetchPerfStats]);

  // ─── 4. 已實現 ───
  // 用 ref 讓 realtime channel 內可呼叫到最新的 fetchRealized（避免重構前的隱性 closure bug）
  const fetchRealized = useCallback(async () => {
    if (!expertId) {
      setRealizedLoading(false);
      return;
    }
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

    if (!error) setRealizedRows(data || []);
    setRealizedLoading(false);
  }, [expertId, realizedPeriod]);

  const fetchRealizedRef = useRef(fetchRealized);
  useEffect(() => { fetchRealizedRef.current = fetchRealized; }, [fetchRealized]);

  useEffect(() => {
    fetchRealized();
  }, [fetchRealized]);

  // ─── 5. 未實現持倉（含 realtime） ───
  useEffect(() => {
    if (!expertId || !expertOwnerUserId) return;

    const fetchInitial = async () => {
      // 1. 取得 open 持倉 from trade_records
      const { data: tradeData } = await supabase
        .from('trade_records')
        .select('id, instrument, entry_price, current_price, pnl_percent, quantity, quantity_unit, status')
        .eq('expert_id', expertId)
        .eq('status', 'open');

      // 1b. 取得 trade_signals (open) — 用於 pending 週記尚無 trade_records 的持倉
      const { data: tsData } = await supabase
        .from('trade_signals')
        .select('id, symbol, name, entry_price, status')
        .eq('user_id', expertOwnerUserId)
        .eq('status', 'open');

      // 2. 取得 user_performances 的即時數據
      const { data: perfData } = await supabase
        .from('user_performances')
        .select('symbol, current_price, pnl, pnl_percent, entry_price')
        .eq('user_id', expertOwnerUserId);

      const perfMap = new Map<string, { current_price: number | null; pnl: number | null; pnl_percent: number | null; entry_price: number | null }>();
      (perfData || []).forEach(p => {
        perfMap.set(p.symbol, {
          current_price: p.current_price ? Number(p.current_price) : null,
          pnl: p.pnl ? Number(p.pnl) : null,
          pnl_percent: p.pnl_percent ? Number(p.pnl_percent) : null,
          entry_price: p.entry_price ? Number(p.entry_price) : null,
        });
      });

      const tradeSymbols = new Set((tradeData || []).map(r => r.instrument.split(' ')[0]));

      // 3. Fallback: current_prices
      const allSymbols = [...tradeSymbols, ...(tsData || []).map(t => t.symbol)];
      const symbolsWithoutPerf = allSymbols.filter(sym => !perfMap.has(sym));

      if (symbolsWithoutPerf.length > 0) {
        const { data: priceData } = await supabase
          .from('current_prices')
          .select('symbol, price')
          .in('symbol', [...new Set(symbolsWithoutPerf)]);

        (priceData || []).forEach(p => {
          if (p.price != null) {
            perfMap.set(p.symbol, {
              current_price: Number(p.price),
              pnl: null,
              pnl_percent: null,
              entry_price: null,
            });
          }
        });
      }

      const trRows: PerfRow[] = (tradeData || []).map(r => {
        const parts = r.instrument.split(' ');
        const symbol = parts[0] || r.instrument;
        const name = parts.slice(1).join(' ') || null;
        const perf = perfMap.get(symbol);
        const entryPrice = r.entry_price ? Number(r.entry_price) : null;
        const curPrice = perf?.current_price ?? (r.current_price ? Number(r.current_price) : null);
        const qty = r.quantity ?? 1;
        const unit = r.quantity_unit || '張';
        const shares = unit === '張' ? qty * 1000 : qty;
        let pnlPct = perf?.pnl_percent ?? (r.pnl_percent ? Number(r.pnl_percent) : null);
        if (pnlPct == null && curPrice != null && entryPrice != null && entryPrice > 0) {
          pnlPct = Math.round(((curPrice - entryPrice) / entryPrice) * 10000) / 100;
        }
        // 損益金額：永遠用 (現價-進場價) × 股數，user_performances.pnl 是每股價差不能直接用
        const pnl = (curPrice != null && entryPrice != null)
          ? Math.round((curPrice - entryPrice) * shares)
          : null;
        return {
          id: r.id,
          instrument: r.instrument,
          symbol,
          name,
          entry_price: entryPrice,
          current_price: curPrice,
          pnl,
          pnl_percent: pnlPct,
          quantity: qty,
          quantity_unit: unit,
          status: r.status,
        };
      });

      // 4. Merge trade_signals rows not yet in trade_records (pending mentor signals)
      const tsRows: PerfRow[] = (tsData || [])
        .filter(t => !tradeSymbols.has(t.symbol))
        .map(t => {
          const perf = perfMap.get(t.symbol);
          const entryPrice = t.entry_price ? Number(t.entry_price) : (perf?.entry_price ?? null);
          const curPrice = perf?.current_price ?? null;
          let pnl = perf?.pnl ?? null;
          let pnlPct = perf?.pnl_percent ?? null;
          if (pnl == null && curPrice != null && entryPrice != null && entryPrice > 0) {
            pnl = Math.round((curPrice - entryPrice) * 1000) / 1000;
            pnlPct = Math.round(((curPrice - entryPrice) / entryPrice) * 10000) / 100;
          }
          return {
            id: `ts-${t.id}`,
            instrument: `${t.symbol} ${t.name || ''}`.trim(),
            symbol: t.symbol,
            name: t.name || null,
            entry_price: entryPrice,
            current_price: curPrice,
            pnl,
            pnl_percent: pnlPct,
            quantity: 1,
            quantity_unit: '張',
            status: 'open',
          };
        });

      setRows([...trRows, ...tsRows]);
      setLoading(false);
    };

    fetchInitial();

    const perfChannel = supabase
      .channel('admin-perf-user-performances')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_performances',
          filter: `user_id=eq.${expertOwnerUserId}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const row = payload.new as any;
            const sym = row.symbol;
            setRows(prev => prev.map(r => {
              if (r.symbol !== sym) return r;
              const cur = row.current_price ? Number(row.current_price) : r.current_price;
              const pct = row.pnl_percent ? Number(row.pnl_percent) : r.pnl_percent;
              const shares = (r.quantity_unit === '張' ? r.quantity * 1000 : r.quantity);
              const pnl = (cur != null && r.entry_price != null)
                ? Math.round((cur - r.entry_price) * shares)
                : r.pnl;
              return { ...r, current_price: cur, pnl, pnl_percent: pct };
            }));
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as any;
            // 不從列表移除，只清空即時數據
            setRows(prev => prev.map(r =>
              r.symbol === old.symbol
                ? { ...r, current_price: null, pnl: null, pnl_percent: null }
                : r
            ));
          }
        },
      )
      .subscribe();

    const tradeChannel = supabase
      .channel('admin-perf-trade-records')
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
            if (row.status === 'open') {
              const parts = (row.instrument || '').split(' ');
              setRows(prev => [...prev, {
                id: row.id,
                instrument: row.instrument,
                symbol: parts[0] || row.instrument,
                name: parts.slice(1).join(' ') || null,
                entry_price: row.entry_price ? Number(row.entry_price) : null,
                current_price: row.current_price ? Number(row.current_price) : null,
                pnl: null,
                pnl_percent: row.pnl_percent ? Number(row.pnl_percent) : null,
                quantity: row.quantity ?? 1,
                quantity_unit: row.quantity_unit || '張',
                status: row.status,
              }]);
            } else if (row.status === 'closed') {
              // 部分賣出產生的 closed 紀錄 → 刷新已實現損益
              fetchRealizedRef.current();
            }
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as any;
            if (row.status !== 'open') {
              setRows(prev => prev.filter(r => r.id !== row.id));
              fetchRealizedRef.current();
            } else {
              setRows(prev => prev.map(r => r.id === row.id ? {
                ...r,
                quantity: row.quantity ?? r.quantity,
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
      supabase.removeChannel(perfChannel);
      supabase.removeChannel(tradeChannel);
    };
  }, [expertId, expertOwnerUserId]);

  // ─── 6. 統計摘要 ───
  const unrealizedSummary = useMemo(() => {
    const totalPct = rows.length > 0
      ? rows.reduce((sum, r) => sum + (r.pnl_percent ?? 0), 0) / rows.length
      : 0;
    return { totalPct, count: rows.length };
  }, [rows]);

  const realizedSummary = useMemo(() => {
    const total = realizedRows.reduce((sum, r) => {
      if (r.entry_price && r.exit_price) return sum + (r.exit_price - r.entry_price);
      return sum;
    }, 0);
    const totalPct = realizedRows.length > 0
      ? realizedRows.reduce((sum, r) => sum + (r.pnl_percent ?? 0), 0) / realizedRows.length
      : 0;
    const winCount = realizedRows.filter(r => (r.pnl_percent ?? 0) > 0).length;
    const winRate = realizedRows.length > 0 ? (winCount / realizedRows.length) * 100 : 0;
    return { total, totalPct, count: realizedRows.length, winRate };
  }, [realizedRows]);

  return {
    expertRole,
    capital,
    totalPnlPercent,
    avgPnlPercent,
    rows,
    realizedRows,
    loading,
    realizedLoading,
    realizedPeriod,
    setRealizedPeriod,
    unrealizedSummary,
    realizedSummary,
  };
}
