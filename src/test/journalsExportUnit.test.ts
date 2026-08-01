/**
 * P0 Step 6 regression: weekly journal export 單位不得因 quantity_unit 缺值退回硬編「股」。
 * 覆蓋所有 asset_class × (缺值 / 誤寫「張」 / 合法值) 分支，含 buildMentorMarkdown 整合驗證。
 */
import { describe, it, expect } from 'vitest';
import { resolveExportUnit, buildMentorMarkdown, deriveCostBasis, type JournalRowExport } from '@/lib/journalsExport';

const baseExpert = (asset_class: string, currency = '') => ({
  name: 'T', slug: 't', role: 'mentor', asset_class, currency,
});
const row = (asset_class: string, quantity_unit: string | null, extra: Partial<JournalRowExport> = {}): JournalRowExport => ({
  id: 'sig-1',
  status: 'published',
  instrument: 'AAPL',
  action: 'buy',
  price_hint: 100,
  quantity: 10,
  quantity_unit,
  reason_summary: 'buy',
  reason_detail: null, risk_notes: null, learning_points: null,
  published_at: '2026-07-01T02:00:00Z', created_at: '2026-07-01T02:00:00Z',
  expert_id: 'e1',
  experts: baseExpert(asset_class, 'USD'),
  ...extra,
});

describe('resolveExportUnit — asset_class 主導單位', () => {
  it('us_stock + null → 股（絕不退成張）', () => {
    expect(resolveExportUnit(row('us_stock', null))).toBe('股');
  });
  it('us_stock + 誤寫「張」→ 覆寫回股', () => {
    expect(resolveExportUnit(row('us_stock', '張'))).toBe('股');
  });
  it('us_future / us_option → 口（缺值或誤寫皆覆寫）', () => {
    expect(resolveExportUnit(row('us_future', null))).toBe('口');
    expect(resolveExportUnit(row('us_future', '張'))).toBe('口');
    expect(resolveExportUnit(row('us_option', ''))).toBe('口');
  });
  it('tw_future / tw_option → 口', () => {
    expect(resolveExportUnit(row('tw_future', null))).toBe('口');
    expect(resolveExportUnit(row('tw_option', '張'))).toBe('口');
  });
  it('crypto → 顆', () => {
    expect(resolveExportUnit(row('crypto', null))).toBe('顆');
    expect(resolveExportUnit(row('crypto', '張'))).toBe('顆');
  });
  it('tw_stock 保留合法張/股，缺值預設張', () => {
    expect(resolveExportUnit(row('tw_stock', '張'))).toBe('張');
    expect(resolveExportUnit(row('tw_stock', '股'))).toBe('股');
    expect(resolveExportUnit(row('tw_stock', null))).toBe('張');
  });
  it('未知 asset_class + currency=USD → 股', () => {
    const r = row('', null);
    r.experts = baseExpert('', 'USD');
    expect(resolveExportUnit(r)).toBe('股');
  });
});

describe('buildMentorMarkdown — us_stock 匯出絕不出現「張」', () => {
  const range = { startLabel: '2026-06-29', endLabel: '2026-07-05' };
  it('us_stock quantity_unit=null → 印 10 股，不含 張', () => {
    const md = buildMentorMarkdown([row('us_stock', null)], range);
    expect(md).toContain('10 股');
    expect(md).not.toMatch(/10 張/);
  });
  it('us_future quantity_unit=張 → 覆寫回 口', () => {
    const md = buildMentorMarkdown([row('us_future', '張')], range);
    expect(md).toContain('10 口');
    expect(md).not.toMatch(/10 張/);
  });
  it('本週總計不再硬編「0 股」', () => {
    const md = buildMentorMarkdown(
      [row('us_stock', null, { action: 'hold', quantity: 0 })],
      range,
    );
    // hold 動作不會納入 totals → 應顯示「無」而非「0 股」
    expect(md).not.toMatch(/：0 股/);
  });
});

describe('deriveCostBasis / 出場成本價', () => {
  const recs = [
    { expert_id: 'e1', instrument: 'NVDA', quantity: 50, quantity_unit: '股', entry_date: '2026-06-18T00:00:00Z', exit_date: null, entry_price: 100 },
    { expert_id: 'e1', instrument: 'NVDA', quantity: 50, quantity_unit: '股', entry_date: '2026-06-20T00:00:00Z', exit_date: null, entry_price: 120 },
    { expert_id: 'e1', instrument: 'OLD', quantity: 10, quantity_unit: '股', entry_date: '2026-06-01T00:00:00Z', exit_date: '2026-06-05T00:00:00Z', entry_price: 9 },
  ];
  const keys = new Set(['e1::NVDA', 'e1::OLD']);
  const startIso = '2026-07-27T00:00:00Z';

  it('以股數加權平均計算成本價', () => {
    const m = deriveCostBasis(recs as any, keys, startIso);
    expect(m.get('e1::NVDA')).toBe(110);
  });

  it('週初前已平倉的紀錄不計入', () => {
    const m = deriveCostBasis(recs as any, keys, startIso);
    expect(m.has('e1::OLD')).toBe(false);
  });

  it('賣出訊號的 Markdown 會列出當時成本價與報酬率', () => {
    const md = buildMentorMarkdown(
      [{ id: 's1', expert_id: 'e1', instrument: 'NVDA', action: 'sell', quantity: 50, quantity_unit: '股', price_hint: 132, experts: { name: '老周', slug: 'zhou', asset_class: 'us_stock', currency: 'USD' } } as any],
      { startLabel: '2026-07-27', endLabel: '2026-08-02' },
      { costBasis: deriveCostBasis(recs as any, keys, startIso) },
    );
    expect(md).toContain('當時成本價：110');
    expect(md).toContain('對成本報酬率：+20.00%');
  });

  it('買進訊號不會列出成本價', () => {
    const md = buildMentorMarkdown(
      [{ id: 's2', expert_id: 'e1', instrument: 'NVDA', action: 'buy', quantity: 50, quantity_unit: '股', price_hint: 132, experts: { name: '老周', asset_class: 'us_stock' } } as any],
      { startLabel: '2026-07-27', endLabel: '2026-08-02' },
      { costBasis: deriveCostBasis(recs as any, keys, startIso) },
    );
    expect(md).not.toContain('當時成本價');
  });

  it('查無歷史持倉時標示「無歷史持倉紀錄」', () => {
    const md = buildMentorMarkdown(
      [{ id: 's3', expert_id: 'e1', instrument: 'TSLA', action: 'exit', quantity: 5, quantity_unit: '股', price_hint: 200, experts: { name: '老周', asset_class: 'us_stock' } } as any],
      { startLabel: '2026-07-27', endLabel: '2026-08-02' },
      {},
    );
    expect(md).toContain('當時成本價：無歷史持倉紀錄');
  });
});
