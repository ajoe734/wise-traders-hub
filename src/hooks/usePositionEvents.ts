import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PositionEventAction = 'buy' | 'add' | 'trim' | 'sell' | 'exit' | 'correction';

export interface PositionEvent {
  id: string;
  expert_id: string;
  source_signal_id: string | null;
  symbol: string;
  instrument: string;
  action: PositionEventAction;
  quantity_delta: number;
  quantity_after: number;
  quantity_unit: string;
  trade_price: number | null;
  currency: 'TWD' | 'USD';
  asset_class: string;
  event_at: string;
  source_kind: 'live' | 'reconstructed' | 'correction';
}

export function usePositionEvents(expertId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['position-events', expertId] as const, [expertId]);
  const query = useQuery({
    queryKey,
    enabled: Boolean(expertId),
    staleTime: 30_000,
    queryFn: async (): Promise<PositionEvent[]> => {
      if (!expertId) return [];
      const [eventsResult, issuesResult] = await Promise.all([
        supabase
          .from('position_events')
          .select('id, expert_id, source_signal_id, symbol, instrument, action, quantity_delta, quantity_after, quantity_unit, trade_price, currency, asset_class, event_at, source_kind')
          .eq('expert_id', expertId)
          .order('event_at', { ascending: false })
          .limit(500),
        supabase
          .from('position_event_reconstruction_issues')
          .select('symbol')
          .eq('expert_id', expertId),
      ]);
      if (eventsResult.error) throw eventsResult.error;
      if (issuesResult.error) throw issuesResult.error;
      const excludedSymbols = new Set((issuesResult.data ?? []).map((row) => row.symbol));
      return (eventsResult.data ?? []).filter((row) => row.source_kind !== 'reconstructed' || !excludedSymbols.has(row.symbol)).map((row) => ({
        ...row,
        action: row.action as PositionEventAction,
        quantity_delta: Number(row.quantity_delta),
        quantity_after: Number(row.quantity_after),
        trade_price: row.trade_price == null ? null : Number(row.trade_price),
        currency: row.currency as 'TWD' | 'USD',
        source_kind: row.source_kind as PositionEvent['source_kind'],
      }));
    },
  });

  useEffect(() => {
    if (!expertId) return;
    const channel = supabase
      .channel(`position-events-${expertId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'position_events', filter: `expert_id=eq.${expertId}` }, () => {
        void queryClient.invalidateQueries({ queryKey });
        void queryClient.invalidateQueries({ queryKey: ['expert-holdings-bundle', expertId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [expertId, queryClient, queryKey]);

  return query;
}