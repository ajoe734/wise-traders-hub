import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAnalystSignals } from '@/lib/analystDataAccess';

export interface AdminSignalsBundle {
  expert: any | null;
  signals: any[];
  openInstruments: Set<string>;
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
  openInstruments: new Set(),
  plans: [],
  signalTemplates: [],
};

/**
 * 將原本 admin/Signals.tsx 內 4 個串行 supabase 查詢
 * （experts → expert_signals → trade_records → expert_plans → expert_signal_templates）
 * 整併為單一 React Query，並提供 setter 與 refetch helper。
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

      const [{ signals }, openTradesRes, plansRes, tplRes] = await Promise.all([
        fetchAnalystSignals(supabase, exp.id),
        supabase
          .from('trade_records')
          .select('instrument')
          .eq('expert_id', exp.id)
          .eq('status', 'open'),
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
        openInstruments: new Set((openTradesRes.data || []).map((t: any) => t.instrument)),
        plans: (plansRes.data as any) || [],
        signalTemplates: (tplRes.data as any) || [],
      };
    },
  });

  const bundle = query.data ?? EMPTY;

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
    openInstruments: bundle.openInstruments,
    plans: bundle.plans,
    signalTemplates: bundle.signalTemplates,
    loading: query.isLoading,
    setSignals,
    refetch,
  };
}
