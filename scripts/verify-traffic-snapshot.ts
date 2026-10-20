import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { reconcileDaily, type DailyPageCount } from '../src/lib/analytics/trafficRecovery';
const input = process.argv[2];
assert(input, 'Usage: bun scripts/verify-traffic-snapshot.ts <aggregate-only snapshot.json>');
const snapshot = JSON.parse(readFileSync(input, 'utf8')) as {
  collected: DailyPageCount[]; reported: DailyPageCount[];
  overview: { day: string; page_views: number }[];
};
assert(snapshot.collected.length > 0, 'empty snapshot is not full-period verification');
// Replay aggregate counts without real visitor IDs or personal data.
const events = snapshot.collected.flatMap(r => Array.from({ length: r.page_views }, (_, i) => ({
  visitor_id: `offline-${i}`, user_id: null, route: r.path, event_name: 'page_view',
  occurred_at: `${r.day}T00:00:00+08:00`, is_internal: false,
})));
assert.deepEqual(reconcileDaily(events, snapshot.reported), []);
const days = new Map<string, number>();
for (const r of snapshot.collected) days.set(r.day, (days.get(r.day) ?? 0) + r.page_views);
for (const r of snapshot.overview) {
  assert.equal(r.page_views, days.get(r.day) ?? 0, `overview mismatch: ${r.day}`);
  days.delete(r.day);
}
assert.equal(days.size, 0, 'overview omitted dates');
console.log(`PASS entire snapshot: ${snapshot.collected.length} date/routes, ${snapshot.overview.length} days, ${events.length} pages`);