/**
 * R1-P — runtime closure for the 10 public legacy readers.
 *
 * Every reader in db/r1/p/public_legacy_readers.json must have a runtime test
 * here. Classification rules enforced:
 *  - typed_public_contract : reads economic facts on a public/entitled surface
 *                            → must pass through the typed contract gate.
 *  - entitled_non_economic : entitled surface that reads NO economic column
 *                            (head/count only).
 *  - internal_owner_only   : guard is stronger than "just logged in"
 *                            (owner-only RLS / company_admin / service_role).
 * `authenticated` alone is NEVER sufficient to classify a reader internal.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  gateSignalEconomics,
  gatePerformance,
  gateSeries,
} from '@/contracts/publicEconomicContract';
import {
  UNKNOWN_PROJECTION,
  NO_PROJECTION,
  resolveProjectionStatus,
  REVIEW_BADGE,
  REVIEW_NOTE,
} from '@/contracts/publicProjection';
import { fetchProjectionStatusForExperts } from '@/lib/fetchProjectionStatus';
import { fetchAnalystSignals, fetchAnalystTradeRecords } from '@/lib/analystDataAccess';

const ROOT = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'db/r1/p/public_legacy_readers.json'), 'utf8'),
) as {
  total: number;
  readers: { path: string; kind: string; role: string; test_id: string; evidence: unknown }[];
};

const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const KINDS = new Set(['typed_public_contract', 'entitled_non_economic', 'internal_owner_only']);

describe('R1-P public legacy readers — manifest integrity', () => {
  it('has exactly 10 readers, no ambiguous classification', () => {
    expect(manifest.total).toBe(10);
    expect(manifest.readers).toHaveLength(10);
    for (const r of manifest.readers) {
      expect(KINDS.has(r.kind), `${r.path} kind=${r.kind}`).toBe(true);
      expect(r.test_id, `${r.path} missing test_id`).toBeTruthy();
      expect(r.evidence, `${r.path} missing evidence`).toBeTruthy();
    }
  });

  it('never uses bare "authenticated" as the internal justification', () => {
    for (const r of manifest.readers.filter((x) => x.kind === 'internal_owner_only')) {
      expect(String(r.evidence)).toMatch(/owner|company_admin|service_role|cron|RLS/i);
    }
  });

  it('every listed source file exists and is reachable', () => {
    for (const r of manifest.readers) {
      expect(fs.existsSync(path.join(ROOT, r.path)), r.path).toBe(true);
    }
  });
});

describe('R1-P typed_public_contract readers import the gate', () => {
  const gated = manifest.readers.filter((r) => r.kind === 'typed_public_contract');

  it.each(gated.map((r) => r.path))('%s passes economics through the contract', (p) => {
    const src = read(p);
    expect(
      /publicEconomicContract|publicProjection|useProjectionStatus|fetchProjectionStatus/.test(src),
      `${p} reads economics without the typed contract`,
    ).toBe(true);
  });
});

describe('R1-P entitled_non_economic readers select no economic column', () => {
  const nonEcon = manifest.readers.filter((r) => r.kind === 'entitled_non_economic');
  const ECON = /select\(\s*['"`][^'"`]*(price|pnl|quantity|capital|return|amount)/i;

  it.each(nonEcon.map((r) => r.path))('%s only counts rows', (p) => {
    const src = read(p);
    expect(ECON.test(src), `${p} selects an economic column`).toBe(false);
    expect(/count:\s*'exact'/.test(src), `${p} is not a head/count reader`).toBe(true);
  });
});

describe('R1-P internal_owner_only readers are owner-scoped at runtime', () => {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const rec = { table, filters: {} as Record<string, unknown> };
      calls.push(rec);
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          rec.filters[k] = v;
          return chain;
        },
        order: () => Promise.resolve({ data: [], error: null }),
        then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return chain;
    },
  };

  it('analystDataAccess always filters by the owning expert_id', async () => {
    await fetchAnalystSignals(db as any, 'expert-1');
    await fetchAnalystTradeRecords(db as any, 'expert-1');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.filters.expert_id).toBe('expert-1');
  });

  it('a plain authenticated user cannot widen the scope (no unfiltered read path)', () => {
    const src = read('src/lib/analystDataAccess.ts');
    const selects = src.match(/\.from\('(expert_signals|trade_records)'\)[\s\S]{0,220}?;/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect(s).toMatch(/\.eq\('expert_id'/);
  });
});

describe('R1-P fail-closed defaults', () => {
  it('unknown / not-loaded projection hides numbers', () => {
    expect(UNKNOWN_PROJECTION.showNumbers).toBe(false);
    expect(UNKNOWN_PROJECTION.badge).toBe(REVIEW_BADGE);
    expect(UNKNOWN_PROJECTION.note).toBe(REVIEW_NOTE);
    expect(resolveProjectionStatus({}).showNumbers).toBe(false);
    expect(resolveProjectionStatus(null).showNumbers).toBe(false);
    expect(resolveProjectionStatus({ state: null }).showNumbers).toBe(false);
  });

  it('an API error is fail-closed, never legacy numbers', () => {
    const s = resolveProjectionStatus({ failed: true });
    expect(s.state).toBe('error');
    expect(s.showNumbers).toBe(false);
    expect(s.showReviewNotice).toBe(true);
  });

  it('an absent projection is fail-closed — no legacy numbers', () => {
    expect(NO_PROJECTION.state).toBe('incomplete');
    expect(NO_PROJECTION.showNumbers).toBe(false);
    expect(NO_PROJECTION.showReviewNotice).toBe(true);
  });

  it('gates strip every economic field when not ready', () => {
    const rows = gateSignalEconomics(
      [{ id: 's1', instrument: '6515', entry_price: 100, quantity: 10, reason_summary: 'x' }],
      UNKNOWN_PROJECTION,
    ) as Record<string, unknown>[];
    expect(rows[0].entry_price).toBeNull();
    expect(rows[0].quantity).toBeNull();
    expect(rows[0].under_review).toBe(true);
    expect(rows[0].reason_summary).toBe('x');

    const perf = gatePerformance({ win_rate: 55, total_trades: 3 }, UNKNOWN_PROJECTION)!;
    expect(perf.win_rate).toBeNull();
    expect(perf.total_trades).toBeNull();
    expect(gateSeries([{ v: 1 }], UNKNOWN_PROJECTION)).toEqual([]);
  });
});

describe('R1-P fetchProjectionStatusForExperts', () => {
  const stub = (result: { data?: unknown; error?: unknown }) => ({
    from: () => ({
      select: () => ({ in: () => Promise.resolve(result) }),
    }),
  });

  it('missing relation (pre-cutover) → fail-closed incomplete', async () => {
    const s = await fetchProjectionStatusForExperts(['e1'], stub({ error: { code: '42P01' } }) as any);
    expect(s.state).toBe('incomplete');
    expect(s.showNumbers).toBe(false);
  });

  it('read failure → error, numbers hidden', async () => {
    const s = await fetchProjectionStatusForExperts(['e1'], stub({ error: { code: '500' } }) as any);
    expect(s.state).toBe('error');
    expect(s.showNumbers).toBe(false);
  });

  it('worst state wins across a multi-expert scope (6515 manual_review)', async () => {
    const s = await fetchProjectionStatusForExperts(
      ['e1', 'e2'],
      stub({
        data: [
          { state: 'ready', manual_review_count: 0, incomplete_count: 0, withheld_count: 0 },
          { state: 'ready', manual_review_count: 1, incomplete_count: 0, withheld_count: 0 },
        ],
      }) as any,
    );
    expect(s.state).toBe('manual_review');
    expect(s.showNumbers).toBe(false);
  });

  it('all ready → numbers allowed', async () => {
    const s = await fetchProjectionStatusForExperts(
      ['e1'],
      stub({
        data: [{ state: 'ready', manual_review_count: 0, incomplete_count: 0, withheld_count: 0 }],
      }) as any,
    );
    expect(s.state).toBe('ready');
    expect(s.showNumbers).toBe(true);
  });
});
