import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useExpertHoldingsBundle } from '@/hooks/useExpertHoldingsBundle';
import type {
  RealizedRow,
  RealizedPeriod,
} from '@/pages/_adminPerformance/types';
import { normalizeAssetClass, type AssetClass } from '@/lib/asset';

/**
 * 集中管理 admin/Performance 頁所需資料。
 * 資料源（capital / openPositions / totalPnl / avgPnl）統一由
 * `useExpertHoldingsBundle` 提供 — 禁止再直接讀 trade_records / RPC。
 * Realized rows 因 period 篩選不同仍自管，但由 bundle realtime 觸發 invalidate。
 */
export function useAdminPerformanceData(expertSlug: string | undefined) {
  const [expertId, setExpertId] = useState<string | null>(null);
  const [expertOwnerUserId, setExpertOwnerUserId] = useState<string | null>(null);
  const [expertRole, setExpertRole] = useState<string | null>(null);
  const [expertCurrency, setExpertCurrency] = useState<'TWD' | 'USD'>('TWD');
  const [expertAssetClass, setExpertAssetClass] = useState<AssetClass>('tw_stock');
  const [realizedRows, setRealizedRows] = useState<RealizedRow[]>([]);
  const [realizedLoading, setRealizedLoading] = useState(true);
  const [realizedPeriod, setRealizedPeriod] = useState<RealizedPeriod>('month');

  // ─── 1. expert 基本資料 ───
  useEffect(() => {
    if (!expertSlug) {
      setRealizedLoading(false);
      return;
    }
    supabase
      .from('experts')
      .select('id, role, user_id, currency, asset_class')
      .eq('slug', expertSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExpertId(data.id);
          setExpertRole(data.role);
          setExpertOwnerUserId(data.user_id);
          setExpertCurrency((data as any).currency === 'USD' ? 'USD' : 'TWD');
          setExpertAssetClass(normalizeAssetClass((data as any).asset_class ?? (data as any).currency));
        } else {
          setRealizedLoading(false);
        }
      });
  }, [expertSlug]);

  // ─── 2. 統一資料源：capital / openPositions / total / avg pnl ───
  const bundle = useExpertHoldingsBundle(expertId || undefined, {
    expertOwnerUserId,
    currency: expertCurrency,
    assetClass: expertAssetClass,
  });
  const { capital, openPositions: rows, totalPnlPercent, avgPnlPercent, loading, currency, assetClass } = bundle;

  // ─── 3. 已實現（period 篩選） ───
  const fetchRealized = useCallback(async () => {
    if (!expertId) {
      setRealizedLoading(false);
      return;
    }
    setRealizedLoading(true);

    const now = new Date();
    let fromDate: Date;
    if (realizedPeriod === 'week') {
      fromDate = new Date(now); fromDate.setDate(now.getDate() - 7);
    } else if (realizedPeriod === 'month') {
      fromDate = new Date(now); fromDate.setMonth(now.getMonth() - 1);
    } else {
      fromDate = new Date(now); fromDate.setFullYear(now.getFullYear() - 1);
    }

    // trade_records has no asset_class column; selecting it made PostgREST
    // answer 400 and silently emptied the realized tab (P0-PV E14).
    const { data, error } = await supabase
      .from('trade_records')
      .select('id, instrument, entry_price, exit_price, entry_date, exit_date, pnl_percent, status, currency')
      .eq('expert_id', expertId)
      .eq('status', 'closed')
      .gte('exit_date', fromDate.toISOString())
      .order('exit_date', { ascending: false });

    if (!error) {
      const mapped: RealizedRow[] = (data || []).map((r: any) => ({
        ...r,
        currency: r.currency === 'USD' ? 'USD' : expertCurrency,
        asset_class: normalizeAssetClass(r.asset_class ?? expertAssetClass),
      }));
      setRealizedRows(mapped);
    } else {
      setRealizedRows([]);
    }

    setRealizedLoading(false);
  }, [expertId, realizedPeriod, expertCurrency, expertAssetClass]);


  const fetchRealizedRef = useRef(fetchRealized);
  useEffect(() => { fetchRealizedRef.current = fetchRealized; }, [fetchRealized]);

  useEffect(() => { fetchRealized(); }, [fetchRealized]);

  // bundle 數值變動（trade_records 事件後）→ 同步刷新 realized
  const realizedSignal = capital?.realized_pnl_amount ?? null;
  useEffect(() => {
    if (!expertId) return;
    fetchRealizedRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realizedSignal, expertId]);

  // ─── 4. 統計摘要 ───
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
    expertCurrency: currency,
    expertAssetClass: assetClass,
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

