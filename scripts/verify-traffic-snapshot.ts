import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { reconcilePageCounts, type DailyPageCount } from '../src/lib/analytics/trafficRecovery';
const input = process.argv[2];
assert(input, 'Usage: bun scripts/verify-traffic-snapshot.ts <aggregate-only snapshot.json>');
const snapshot = JSON.parse(readFileSync(input, 'utf8')) as {
  collected: DailyPageCount[]; reported: DailyPageCount[];
  overview: { day: string; page_views: number }[];
  from: string; toExclusive: string;
};
assert(snapshot.collected.length > 0, 'empty snapshot is not full-period verification');
assert.deepEqual(reconcilePageCounts(snapshot.collected, snapshot.reported), []);
const days = new Map<string, number>();
for (const r of snapshot.collected) days.set(r.day, (days.get(r.day) ?? 0) + r.page_views);
const seen = new Set<string>();
for (const r of snapshot.overview) {
  assert(!seen.has(r.day), `duplicate overview date: ${r.day}`);
  seen.add(r.day);
  assert(Number.isSafeInteger(r.page_views) && r.page_views >= 0, 'invalid overview count');
  assert.equal(r.page_views, days.get(r.day) ?? 0, `overview mismatch: ${r.day}`);
  days.delete(r.day);
}
assert.equal(days.size, 0, 'overview omitted dates');
assert(Number.isFinite(Date.parse(snapshot.from)) && Date.parse(snapshot.from) < Date.parse(snapshot.toExclusive), 'missing full-period bounds');
for (let day = Date.parse(snapshot.from); day < Date.parse(snapshot.toExclusive); day += 86400000) {
  assert(seen.has(new Date(day).toISOString().slice(0,10)), 'overview omitted zero-traffic date');
}
console.log(`PASS entire snapshot: ${snapshot.collected.length} date/routes, ${snapshot.overview.length} days, ${snapshot.collected.reduce((n,r)=>n+r.page_views,0)} pages`);