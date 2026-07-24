import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CapitalStatus, OpenPosition } from '@/pages/_signalEditor/types';
import type { PerfRow } from '@/pages/_adminPerformance/types';
import type { ExpertPerformance } from '@/hooks/usePerformance';
import { normalizeCurrency, type Currency } from '@/lib/currency';
import { normalizeAssetClass, type AssetClass } from '@/lib/asset';
import { resolvePositionQuantityDisplay } from '@/lib/positionQuantity';

/**
 * 單一資料源：所有 expert 的 capital / holdings / performance / currency
 * 都經此 hook。callers 需傳入 expert.currency 才能顯示正確幣別。
 */


export interface ExpertHoldingsBundle {
  capital: CapitalStatus | null;
  openPositions: PerfRow[];
  rawOpenPositions: OpenPosition[];
  performance: ExpertPerformance | null;
  totalPnlPercent: number | null;
  avgPnlPercent: number | null;
  /** expert.currency (TWD | USD) — 未載入時預設 TWD */
  currency: Currency;
  /** expert.asset_class — 未載入時 fallback tw_stock */
  assetClass: AssetClass;
}

const EMPTY: ExpertHoldingsBundle = {
  capital: null,
  openPositions: [],
  rawOpenPositions: [],
  performance: null,
  totalPnlPercent: null,
  avgPnlPercent: null,
  currency: 'TWD',
  assetClass: 'tw_stock',
};

import { resolvePositionQuantityDisplay } from '@/lib/positionQuantity';

export function mapOpenPositionToRow(p: any, currency: Currency = 'TWD', assetClass: AssetClass = 'tw_stock'): PerfRow {
  const parts = String(p.instrument || p.symbol || '').split(' ');
  const symbol = p.symbol || parts[0] || '';
  const name = parts.slice(1).join(' ') || null;
  const baseShares = Number(p.quantity_shares ?? 0);
  const entryPrice = p.entry_price != null ? Number(p.entry_price) : null;
  const curPrice = p.current_price != null ? Number(p.current_price) : null;
  // pnl 用 base shares 算，不受顯示單位影響
  const pnl = p.unrealized_pnl != null
    ? Number(p.unrealized_pnl)
    : (curPrice != null && entryPrice != null ? Math.round((curPrice - entryPrice) * baseShares) : null);
  const pnlPct = p.unrealized_pct != null
    ? Number(p.unrealized_pct)
    : (curPrice != null && entryPrice != null && entryPrice > 0
        ? Math.round(((curPrice - entryPrice) / entryPrice) * 10000) / 100
        : null);
  const rowAsset: AssetClass = p.asset_class ? normalizeAssetClass(p.asset_class) : assetClass;
  // 契約：quantity_shares 一律是 base 數量；quantity_unit 是偏好顯示單位。
  // 透過 resolvePositionQuantityDisplay 換算成 UI 該顯示的數字＋單位（張/股/口/顆），
  // 零股（例如 500 base + 張）會自動 fallback 成「股」，避免出現「1000 張」這種災難。
  const display = resolvePositionQuantityDisplay(baseShares, p.quantity_unit, rowAsset);
  return {
    id: `pos-${symbol}`,
    instrument: p.instrument || `${symbol} ${name || ''}`.trim(),
    symbol,
    name,
    entry_price: entryPrice,
    current_price: curPrice,
    pnl,
    pnl_percent: pnlPct,
    quantity: display.inputQuantity,
    quantity_unit: display.unit,
    base_quantity: baseShares,
    status: 'open',
    currency: normalizeCurrency(p.currency) || currency,
    asset_class: rowAsset,
  };
}

export function useExpertHoldingsBundle(
  expertId: string | undefined,
  options?: { expertOwnerUserId?: string | null; currency?: Currency | string | null; assetClass?: AssetClass | string | null },
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['expert-holdings-bundle', expertId] as const, [expertId]);
  const currency: Currency = normalizeCurrency(options?.currency);
  const assetClass: AssetClass = normalizeAssetClass(options?.assetClass);

  const query = useQuery<ExpertHoldingsBundle>({
    queryKey,
    enabled: !!expertId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!expertId) return EMPTY;
      const [capRes, perfRes] = await Promise.all([
        supabase.rpc('get_expert_capital_status' as any, { _expert_id: expertId }),
        supabase.rpc('calculate_expert_performance', { _expert_id: expertId }),
      ]);
      const cap = (capRes.data as unknown as CapitalStatus) || null;
      const perf = (perfRes.data as unknown as ExpertPerformance) || null;
      const bundleCurrency = normalizeCurrency(cap?.currency ?? currency);
      const bundleAssetClass = normalizeAssetClass(cap?.asset_class ?? assetClass);
      const rawOpen: OpenPosition[] = Array.isArray(cap?.open_positions) ? cap!.open_positions : [];
      return {
        capital: cap,
        rawOpenPositions: rawOpen,
        openPositions: rawOpen.map((p) => mapOpenPositionToRow(p, bundleCurrency, bundleAssetClass)),
        performance: perf,
        totalPnlPercent: perf?.total_return_pct != null ? Number(perf.total_return_pct) : null,
        avgPnlPercent: perf?.avg_pnl_pct != null ? Number((perf as any).avg_pnl_pct) : null,
        currency: bundleCurrency,
        assetClass: bundleAssetClass,
      };
    },
  });

  // 單一 realtime channel：trade_records + user_performances → 全面 invalidate
  useEffect(() => {
    if (!expertId) return;
    const ownerUserId = options?.expertOwnerUserId ?? null;
    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: ['expert-holdings-bundle', expertId] });
      queryClient.invalidateQueries({ queryKey: ['expert-performance', expertId] });
      queryClient.invalidateQueries({ queryKey: ['period-performance-v3', expertId] });
      // admin-signals-bundle 以 slug 為 key（不知道 slug），用 predicate 全 match
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'admin-signals-bundle',
      });
    };

    let channel = supabase
      .channel(`expert-bundle-${expertId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_records', filter: `expert_id=eq.${expertId}` },
        invalidateAll,
      );
    if (ownerUserId) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_performances', filter: `user_id=eq.${ownerUserId}` },
        invalidateAll,
      );
    }
    const sub = channel.subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [expertId, options?.expertOwnerUserId, queryClient]);

  return {
    ...(query.data ?? EMPTY),
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
