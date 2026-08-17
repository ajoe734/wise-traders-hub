/**
 * Imperative projection-status read (R1-P).
 *
 * Non-hook callers (list fetchers, exports) must resolve a projection status
 * explicitly instead of falling back to the fail-closed default. The rules are
 * the same as `useProjectionStatus`:
 *  - relation/column absent (pre-cutover) → `no_projection`, legacy read path
 *  - any other read failure → `error`, numbers stay hidden
 *  - one scope covering several experts is the WORST state of the set
 */
import { supabase as defaultDb } from '@/integrations/supabase/client';
import {
  resolveProjectionStatus,
  LEGACY_NO_PROJECTION,
  type ProjectionStatus,
} from '@/contracts/publicProjection';

const ABSENT_CODES = new Set(['42P01', '42703', 'PGRST205']);

type Db = { from: (table: string) => any };

export async function fetchProjectionStatusForExperts(
  expertIds: string[],
  db: Db = defaultDb as unknown as Db,
): Promise<ProjectionStatus> {
  if (!expertIds || expertIds.length === 0) return LEGACY_NO_PROJECTION;

  const { data, error } = await db
    .from('public_expert_state_active')
    .select('state, withheld_count, incomplete_count, manual_review_count')
    .in('expert_id', expertIds);

  if (error) {
    const code = (error as { code?: string }).code ?? '';
    // projection not deployed for this environment → explicit legacy path
    if (ABSENT_CODES.has(code)) return LEGACY_NO_PROJECTION;
    return resolveProjectionStatus({ failed: true });
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return LEGACY_NO_PROJECTION;

  const worst = rows.reduce(
    (acc, row) => ({
      manualReview: acc.manualReview || Number(row.manual_review_count ?? 0) > 0 || row.state === 'manual_review',
      incomplete: acc.incomplete || Number(row.incomplete_count ?? 0) > 0 || row.state === 'incomplete',
      withheld: acc.withheld || Number(row.withheld_count ?? 0) > 0 || row.state === 'withheld',
      state: acc.state === 'ready' ? String(row.state ?? 'ready') : acc.state,
    }),
    { manualReview: false, incomplete: false, withheld: false, state: 'ready' as string },
  );

  return resolveProjectionStatus(worst);
}
