import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useMyHoldings(expertId?: string) {
  return useQuery({
    queryKey: ['holdings', expertId],
    queryFn: async () => {
      let query = supabase
        .from('trade_records')
        .select('*')
        .eq('status', 'open');
      if (expertId) {
        query = query.eq('expert_id', expertId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}
