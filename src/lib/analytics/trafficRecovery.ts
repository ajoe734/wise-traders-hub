/** Evidence recovery preserves the original row and timestamp; it never creates traffic. */
export const TRAFFIC_RECOVERY_CUTOFF = '2026-10-19T16:00:00Z';
// Unnamed rows with no properties are the original route-only page writer.
// After this deployment the database discarded unnamed inputs instead.
export const LEGACY_PAGE_END = '2026-08-30T10:00:00Z';
export interface HistoricalPage {
  id: string; event_name: string | null; event_props: Record<string, unknown> | null; occurred_at: string;
}
export function recoverLegacyPage<T extends HistoricalPage>(row: T): T {
  if (row.event_name !== null || row.event_props !== null || !Number.isFinite(Date.parse(row.occurred_at))
    || row.occurred_at >= LEGACY_PAGE_END) return row;
  return { ...row, event_name: 'page_view', event_props: { recovery: 'legacy_route_only_v1', original_event_name: null } };
}