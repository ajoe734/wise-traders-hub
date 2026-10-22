/** 持倉上方摘要的純聚合：供視覺模板使用，不讀寫任何資料。 */
export interface DemoHolding {
  code: string; name: string; industry: string; strategy: string; period: string; position: string;
  cost: number; value: number;
}
export interface IndustryRow { name: string; value: number; count: number; share: number; cells: number }
export interface Summary {
  cost: number; value: number; pnl: number; pnlPct: number; count: number;
  industries: IndustryRow[];
  /** 最大餘數法分配，cells 加總恰為 100 */
  warnings: string[];
  strategy: [string, number][]; period: [string, number][]; position: [string, number][];
  tree: { name: string; value: number; children: { code: string; name: string; value: number; pct: number }[] }[];
}

const PERIOD_LABEL: Record<string, string> = { 短: '短期', 中: '中期', 短中: '短中期', 中長: '中長期' };

function countBy(list: DemoHolding[], key: 'strategy' | 'period' | 'position'): [string, number][] {
  const m = new Map<string, number>();
  for (const h of list) {
    const k = key === 'period' ? PERIOD_LABEL[h.period] || h.period : h[key];
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function buildSummary(list: DemoHolding[]): Summary {
  const cost = list.reduce((a, h) => a + h.cost, 0);
  const value = list.reduce((a, h) => a + h.value, 0);
  const pnl = value - cost;
  const ind = new Map<string, { value: number; count: number }>();
  for (const h of list) {
    const r = ind.get(h.industry) || { value: 0, count: 0 };
    r.value += h.value; r.count += 1; ind.set(h.industry, r);
  }
  const rows = [...ind.entries()].map(([name, r]) => ({ name, ...r, share: value ? (r.value / value) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  const floors = rows.map((r) => Math.floor(r.share));
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = rows.map((r, i) => ({ i, rem: r.share - floors[i] })).sort((a, b) => b.rem - a.rem);
  for (const o of order) { if (rest <= 0) break; floors[o.i] += 1; rest -= 1; }
  const industries = rows.map((r, i) => ({ ...r, cells: value ? floors[i] : 0 }));
  const warnings = industries.filter((r) => r.count >= 3 || r.share > 25).map((r) => `${r.name}(${r.count}檔)`);
  const tree = industries.map((r) => ({
    name: r.name, value: r.value,
    children: list.filter((h) => h.industry === r.name).sort((a, b) => b.value - a.value)
      .map((h) => ({ code: h.code, name: h.name, value: h.value, pct: h.cost ? ((h.value - h.cost) / h.cost) * 100 : 0 })),
  }));
  return {
    cost, value, pnl, pnlPct: cost ? (pnl / cost) * 100 : 0, count: list.length, industries, warnings,
    strategy: countBy(list, 'strategy'), period: countBy(list, 'period'), position: countBy(list, 'position'), tree,
  };
}
