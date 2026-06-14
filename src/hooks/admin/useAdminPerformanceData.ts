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

  // ─── 5. 未實現持倉（單一來源 = get_expert_capital_status RPC，與發布新週記頁同源） ───
  const fetchOpenPositions = useCallback(async (eid: string) => {
    const { data } = await supabase.rpc('get_expert_capital_status' as any, { _expert_id: eid });
    if (!data) {
      setRows([]);
      setLoading(false);
      return;
    }
    const cap = data as any;
    if (cap) setCapital(cap);
    const positions: any[] = Array.isArray(cap?.open_positions) ? cap.open_positions : [];
    const mapped: PerfRow[] = positions.map((p) => {
      const parts = String(p.instrument || p.symbol || '').split(' ');
      const symbol = p.symbol || parts[0] || '';
      const name = parts.slice(1).join(' ') || null;
      const shares = Number(p.quantity_shares ?? 0);
      const entryPrice = p.entry_price != null ? Number(p.entry_price) : null;
      const curPrice = p.current_price != null ? Number(p.current_price) : null;
      const pnl = p.unrealized_pnl != null
        ? Number(p.unrealized_pnl)
        : (curPrice != null && entryPrice != null ? Math.round((curPrice - entryPrice) * shares) : null);
      const pnlPct = p.unrealized_pct != null
        ? Number(p.unrealized_pct)
        : (curPrice != null && entryPrice != null && entryPrice > 0
            ? Math.round(((curPrice - entryPrice) / entryPrice) * 10000) / 100
            : null);
      return {
        id: `pos-${symbol}`,
        instrument: p.instrument || `${symbol} ${name || ''}`.trim(),
        symbol,
        name,
        entry_price: entryPrice,
        current_price: curPrice,
        pnl,
        pnl_percent: pnlPct,
        quantity: shares,
        quantity_unit: '股',
        status: 'open',
      };
    });
    setRows(mapped);
    setLoading(false);
  }, []);

  const fetchOpenPositionsRef = useRef(fetchOpenPositions);
  useEffect(() => { fetchOpenPositionsRef.current = fetchOpenPositions; }, [fetchOpenPositions]);

  useEffect(() => {
    if (!expertId || !expertOwnerUserId) return;

    fetchOpenPositions(expertId);

    // user_performances 只用於即時價格 patch（避免整列刷新閃爍）
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
              const shares = r.quantity;
              const pnl = (cur != null && r.entry_price != null)
                ? Math.round((cur - r.entry_price) * shares)
                : r.pnl;
              return { ...r, current_price: cur, pnl, pnl_percent: pct };
            }));
          }
        },
      )
      .subscribe();

    // trade_records 任何事件 → 重新呼叫 RPC（含 close / partial sell / 新增持倉）
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
        () => {
          fetchOpenPositionsRef.current(expertId);
          fetchRealizedRef.current();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(perfChannel);
      supabase.removeChannel(tradeChannel);
    };
  }, [expertId, expertOwnerUserId, fetchOpenPositions]);

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
