/**
 * Batch 5b queryKey contract — locks the cache key strings so that any
 * accidental rename in the page files will fail this test and force a
 * conscious update of all `invalidateQueries(...)` call sites.
 *
 * We assert by grepping the page source, not by re-running React.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', 'pages', 'company');

function read(file: string) {
  return readFileSync(join(root, file), 'utf-8');
}

describe('Batch 5b — React Query keys & invalidation contract', () => {
  it('Remittance: queryKey + invalidateQueries match', () => {
    const src = read('Remittance.tsx');
    expect(src).toMatch(/queryKey:\s*\['company',\s*'remittance',\s*filter\]/);
    expect(src).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['company',\s*'remittance'\]/);
  });

  it('Subscribers: single combined key', () => {
    const src = read('Subscribers.tsx');
    expect(src).toMatch(/queryKey:\s*\['company',\s*'subscribers'\]/);
  });

  it('Users: keyed by debouncedSearch, invalidates prefix', () => {
    const src = read('Users.tsx');
    expect(src).toMatch(/queryKey:\s*\['company',\s*'users',\s*debouncedSearch\]/);
    expect(src).toMatch(/keepPreviousData/);
    expect(src).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['company',\s*'users'\]/);
  });

  it('AuditLogs: actions (5min) + paged query share prefix', () => {
    const src = read('AuditLogs.tsx');
    expect(src).toMatch(/queryKey:\s*\['company',\s*'audit-logs',\s*'actions'\]/);
    expect(src).toMatch(/queryKey:\s*\['company',\s*'audit-logs',\s*\{[^}]*page[^}]*\}\]/);
    expect(src).toMatch(/staleTime:\s*5\s*\*\s*60_000/);
    expect(src).toMatch(/keepPreviousData/);
  });

  it('BacktestMonitor: single snapshot key + invalidation', () => {
    // Refactored: query key + invalidation live in hooks/company/useBacktestMonitor.ts
    const hookSrc = readFileSync(
      join(__dirname, '..', '..', 'hooks', 'company', 'useBacktestMonitor.ts'),
      'utf-8',
    );
    expect(hookSrc).toMatch(/queryKey:\s*\['company',\s*'backtest-monitor'\]/);
    expect(hookSrc).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['company',\s*'backtest-monitor'\]/);
  });
});
