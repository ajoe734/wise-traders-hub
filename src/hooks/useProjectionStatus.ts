import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  resolveProjectionStatus,
  type ProjectionStatus,
} from '@/contracts/publicProjection';

/**
 * Reads the public projection state for one expert (R1-P contract).
 *
 * The projection tables are not deployed to production yet. A missing
 * relation is still fail-closed: the status becomes `incomplete` and the
 * caller renders 「資料檢核中」. A real failure becomes `error`. Neither ever
 * produces a number.
 */
export function useProjectionStatus(expertId: string | undefined): ProjectionStatus {
  const { data, isError } = useQuery({
    queryKey: ['public-projection-status', expertId],
    enabled: !!expertId,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_expert_state_active' as any)
        .select('state, withheld_count, incomplete_count, manual_review_count')
        .eq('expert_id', expertId!)
        .maybeSingle();
      // relation / column absent (pre-cutover) → fail closed as incomplete
      if (error) {
        const code = (error as { code?: string }).code ?? '';
        if (code === '42P01' || code === '42703' || code === 'PGRST205') return null;
        throw error;
      }
      return (data as unknown as Record<string, unknown> | null) ?? null;
    },
  });

  if (isError) return resolveProjectionStatus({ failed: true });
  if (!data) return resolveProjectionStatus({ absent: true });

  const row = data as Record<string, unknown>;
  return resolveProjectionStatus({
    state: (row.state as string) ?? null,
    manualReview: Number(row.manual_review_count ?? 0) > 0,
    incomplete: Number(row.incomplete_count ?? 0) > 0,
    withheld: Number(row.withheld_count ?? 0) > 0,
  });
}
