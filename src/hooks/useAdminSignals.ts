import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAnalystSignals } from '@/lib/analystDataAccess';
import { useExpertHoldingsBundle } from '@/hooks/useExpertHoldingsBundle';

export interface AdminSignalsBundle {
  expert: any | null;
  signals: any[];
  plans: { id: string; name: string }[];
  signalTemplates: {
    id: string;
    title: string;
    action: string;
    reason: string;
    risk_note: string;
    strategy_note: string;
  }[];
}

const EMPTY: AdminSignalsBundle = {
  expert: null,
  signals: [],
  plans: [],
  signalTemplates: [],
};

/**
 * admin/Signals 列表頁資料。openInstruments 改由 `useExpertHoldingsBundle`
 * 提供（單一資料源），不再直接讀 trade_records。
 */
export function useAdminSignals(expertSlug: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['admin-signals-bundle', expertSlug] as const, [expertSlug]);

  const query = useQuery<AdminSignalsBundle>({
    queryKey,
    enabled: !!expertSlug,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: exp } = await supabase
        .from('experts')
        .select('*')
        .eq('slug', expertSlug!)
        .single();
      if (!exp) return { ...EMPTY };

      const [{ signals }, plansRes, tplRes] = await Promise.all([
        fetchAnalystSignals(supabase, exp.id),
        supabase
          .from('expert_plans')
          .select('id, name')
          .eq('expert_id', exp.id)
          .eq('is_active', true),
        supabase
          .from('expert_signal_templates' as any)
          .select('id, title, action, reason, risk_note, strategy_note')
          .eq('expert_id', exp.id)
          .order('sort_order', { ascending: true }),
      ]);

      return {
        expert: exp,
        signals: signals ?? [],
        plans: (plansRes.data as any) || [],
        signalTemplates: (tplRes.data as any) || [],
      };
    },
  });

  const bundle = query.data ?? EMPTY;
  const expertId = bundle.expert?.id as string | undefined;
  const ownerUserId = (bundle.expert?.user_id as string | undefined) ?? null;

  // 統一資料源：從 holdings bundle 衍生 openInstruments
  const holdings = useExpertHoldingsBundle(expertId, { expertOwnerUserId: ownerUserId });
  const openInstruments = useMemo(
    () => new Set(holdings.rawOpenPositions.map((p) => p.instrument)),
    [holdings.rawOpenPositions],
  );

  const setSignals = useCallback(
    (updater: (prev: any[]) => any[]) => {
      queryClient.setQueryData<AdminSignalsBundle>(queryKey, (prev) => {
        const base = prev ?? EMPTY;
        return { ...base, signals: updater(base.signals) };
      });
    },
    [queryClient, queryKey],
  );

  const refetch = useCallback(() => query.refetch(), [query]);

  return {
    expert: bundle.expert,
    signals: bundle.signals,
    openInstruments,
    plans: bundle.plans,
    signalTemplates: bundle.signalTemplates,
    loading: query.isLoading,
    setSignals,
    refetch,
  };
}
