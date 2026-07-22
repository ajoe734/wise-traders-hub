/**
 * P0 Step 6 regression: weekly journal export 單位不得因 quantity_unit 缺值退回硬編「股」。
 * 覆蓋所有 asset_class × (缺值 / 誤寫「張」 / 合法值) 分支，含 buildMentorMarkdown 整合驗證。
 */
import { describe, it, expect } from 'vitest';
import { resolveExportUnit, buildMentorMarkdown, type JournalRowExport } from '@/lib/journalsExport';

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
