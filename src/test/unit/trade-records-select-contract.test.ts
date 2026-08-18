/**
 * Regression guard for P0-PV E14.
 *
 * `useAdminPerformanceData` selected `asset_class` from `trade_records`, a
 * column that does not exist. PostgREST answered 400, the hook swallowed the
 * error, and the "已實現損益" tab silently rendered "無已實現交易紀錄" even when
 * closed trades existed. This test pins every `.from('trade_records').select()`
 * in the app to the real table contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// public.trade_records columns (production, information_schema ordinal order)
const TRADE_RECORDS_COLUMNS = new Set([
  'id', 'expert_id', 'signal_id', 'instrument', 'entry_price', 'exit_price',
  'entry_date', 'exit_date', 'pnl_percent', 'status', 'created_at',
  'current_price', 'price_updated_at', 'quantity', 'quantity_unit', 'market',
  'currency', 'is_combo', 'combo_strategy', 'net_premium', 'max_loss_per_unit',
  'max_profit_per_unit',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === 'test') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe('trade_records select contract', () => {
  const files = walk('src');

  it('every .from(\'trade_records\').select(...) uses existing columns only', () => {
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /from\(\s*['"]trade_records['"]\s*\)\s*(?:\r?\n\s*)*\.select\(\s*'([^']*)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const cols = m[1]
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
          // ignore embedded resource selects like `experts(name)`
          .filter(c => !c.includes('(') && c !== '*');
        for (const c of cols) {
          const bare = c.split(':').pop()!.trim();
          if (!TRADE_RECORDS_COLUMNS.has(bare)) {
            violations.push(`${file}: unknown column "${bare}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('the realized-performance query in particular does not select asset_class', () => {
    const src = readFileSync('src/hooks/admin/useAdminPerformanceData.ts', 'utf8');
    const select = /from\('trade_records'\)[\s\S]{0,200}?\.select\('([^']+)'\)/.exec(src);
    expect(select).not.toBeNull();
    expect(select![1]).not.toContain('asset_class');
    expect(select![1]).toContain('exit_date');
  });
});
