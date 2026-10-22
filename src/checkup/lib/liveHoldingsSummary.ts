import { aggregateBySector } from './holdingUtils';
import { buildSummary, type Summary } from '@/lib/holdingsSummaryViz';

export type SummaryHolding = { code: string; name?: string; value?: number; integrityIssue?: string };
type Meta = Record<string, { period?: string; position?: string; [key: string]: unknown }>;

/** Presentation projection only: totals are supplied by the existing holdings ledger. */
export function buildLiveHoldingsSummary(holdings: SummaryHolding[], totalCost: number, totalVal: number, stockMeta: Meta, overrides: Meta = {}): Summary {
  const sector = aggregateBySector(holdings, stockMeta, overrides);
  const allocation = buildSummary(sector.industryByValue.map((r) => ({ code: r.key, name: r.key, industry: r.key, value: r.value, cost: 0, strategy: '', period: '', position: '' })));
  const counts = (key: 'period' | 'position'): [string, number][] => {
    const map = new Map<string, number>();
    const labels: Record<string, string> = { 短: '短期', 中: '中期', 短中: '短中期', 中長: '中長期', 長: '長期' };
    for (const h of holdings) {
      const raw = overrides[h.code]?.[key] || stockMeta[h.code]?.[key] || '未分類';
      const label = key === 'period' ? labels[raw] || raw : raw;
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  const pnl = totalVal - totalCost;
  return { ...allocation, cost: totalCost, value: totalVal, pnl, pnlPct: totalCost > 0 ? pnl / totalCost * 100 : 0, count: holdings.length,
    industries: allocation.industries.map((r) => ({ ...r, count: sector.industryByValue.find((s) => s.key === r.name)?.count || 0 })),
    warnings: sector.warnings.map((r) => `${r.key}(${r.count}檔)`),
    strategy: sector.strategyByCount.map((r) => [r.key, r.count]), period: counts('period'), position: counts('position'), tree: [] };
}

export function summaryGaugeRange(pct: number): number {
  return Math.max(30, Math.ceil(Math.abs(pct) / 30) * 30);
}