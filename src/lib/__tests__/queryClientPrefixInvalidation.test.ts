/**
 * R1-P backdoor closure — replacement seam.
 *
 * Six Playwright cases in e2e/batch5b-react-query.spec.ts used to reach into
 * `window.__lfQueryClient` to prove that invalidating a queryKey PREFIX
 * refetches every query nested under it. That global is a writable handle on
 * the application cache, i.e. a way to force economic state from outside
 * React, so it was removed from the runtime bundle. The behaviour it asserted
 * is a property of the shared queryClient configuration, not of the browser,
 * and is pinned here instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const PREFIXES: Array<[string, string[]]> = [
  ['audit-logs', ['company', 'audit-logs']],
  ['backtest-monitor', ['company', 'backtest-monitor']],
  ['knowledge-base', ['company', 'knowledge-base']],
  ['payments', ['company', 'payments']],
  ['plans', ['company', 'plans']],
  ['revenue', ['company', 'revenue']],
];

describe('queryClient prefix invalidation (company admin surfaces)', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it.each(PREFIXES)('invalidating ["company","%s"] marks every nested query stale', (_label, prefix) => {
    const nested = [
      [...prefix, 'page', 1],
      [...prefix, 'actions'],
      [...prefix, 'detail', { id: 'abc' }],
    ];
    for (const key of nested) qc.setQueryData(key, { ok: true });
    // an unrelated cache entry must NOT be touched
    qc.setQueryData(['company', 'other-surface'], { ok: true });

    qc.invalidateQueries({ queryKey: prefix });

    const cache = qc.getQueryCache();
    for (const key of nested) {
      const q = cache.find({ queryKey: key });
      expect(q, `missing cache entry for ${JSON.stringify(key)}`).toBeTruthy();
      expect(q!.state.isInvalidated).toBe(true);
    }
    expect(cache.find({ queryKey: ['company', 'other-surface'] })!.state.isInvalidated).toBe(false);
  });

  it('exact:true invalidation does not cascade to nested keys', () => {
    qc.setQueryData(['company', 'payments'], { ok: true });
    qc.setQueryData(['company', 'payments', 'providers'], { ok: true });

    qc.invalidateQueries({ queryKey: ['company', 'payments'], exact: true });

    const cache = qc.getQueryCache();
    expect(cache.find({ queryKey: ['company', 'payments'] })!.state.isInvalidated).toBe(true);
    expect(cache.find({ queryKey: ['company', 'payments', 'providers'] })!.state.isInvalidated).toBe(false);
  });

  it('no project-owned global exposes the query cache', () => {
    const w = globalThis as unknown as Record<string, unknown>;
    expect(w.__lfQueryClient).toBeUndefined();
  });
});
