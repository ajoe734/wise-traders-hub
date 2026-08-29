import { describe, it, expect } from 'vitest';
import {
  MANUAL_ROW_KEYS,
  buildManualTradeRow,
  createParsedShell,
  appendToParsed,
  removeFromParsed,
  computePreviewIssues,
  validateManualDraft,
  formatTradeDate,
  formatTradeTime,
  qtyRuleFor,
} from '@/checkup/lib/manualTradeEntry';
import { MAX_HOLDINGS } from '@/pages/_freeCheckup/constants.jsx';

const draft = {
  action: '買進',
  code: ' 00637l ',
  name: '元大滬深300正2',
  qty: 5000,
  price: 32.15,
  date: '2026-08-29',
  time: '10:32',
  nameDirty: true,
  bogus: 'should-not-leak',
};

describe('buildManualTradeRow — exact 12-key 白名單', () => {
  it('key 集合精確等於 MANUAL_ROW_KEYS', () => {
    const row = buildManualTradeRow(draft);
    expect(Object.keys(row).sort()).toEqual([...MANUAL_ROW_KEYS].sort());
    expect(MANUAL_ROW_KEYS).toHaveLength(12);
  });

  it('draft 專屬欄位（nameDirty / 任意欄位）被 strip', () => {
    const row = buildManualTradeRow(draft) as unknown as Record<string, unknown>;
    expect(row.nameDirty).toBeUndefined();
    expect(row.bogus).toBeUndefined();
  });

  it('code 正規化、缺值為 null、priceSource 固定 manual', () => {
    const row = buildManualTradeRow(draft);
    expect(row.code).toBe('00637L');
    expect(row.market_price).toBeNull();
    expect(row.amount).toBeNull();
    expect(row.total_cost).toBeNull();
    expect(row.fee).toBeNull();
    expect(row.priceSource).toBe('manual');
    expect(row.date).toBe('2026/8/29');
    expect(row.time).toBe('10:32');
  });

  it('name 空白時 fallback 為 code', () => {
    expect(buildManualTradeRow({ ...draft, name: '   ' }).name).toBe('00637L');
  });

  it('action 只接受買進／賣出', () => {
    expect(buildManualTradeRow({ ...draft, action: '賣出' }).action).toBe('賣出');
    expect(buildManualTradeRow({ ...draft, action: '亂寫' }).action).toBe('買進');
  });
});

describe('日期／時間慣例 round-trip（與 applyCorrections 相同，不引入第二種格式）', () => {
  it('date 為非補零 YYYY/M/D', () => {
    expect(formatTradeDate('2026-08-09')).toBe('2026/8/9');
    expect(formatTradeDate(new Date(2026, 7, 29))).toBe('2026/8/29');
  });

  it('time 為 HH:mm', () => {
    expect(formatTradeTime('9:05')).toBe('09:05');
    expect(formatTradeTime('10:32')).toBe('10:32');
  });
});

describe('appendToParsed / removeFromParsed', () => {
  const row = buildManualTradeRow(draft);

  it('parsed === null → 建 shell 並 append', () => {
    const next = appendToParsed(null, row);
    expect(next).toEqual({ trades: [row], targetPriceUpdates: [], note: '' });
  });

  it('shell 形狀與 checkup-parse response 相容', () => {
    expect(createParsedShell()).toEqual({ trades: [], targetPriceUpdates: [], note: '' });
  });

  it('已有 OCR rows → append 尾端且順序保留', () => {
    const ocrA = { action: '買進', code: '2454', name: '聯發科', qty: 1000, price: 1420 };
    const ocrB = { action: '賣出', code: '2330', name: '台積電', qty: 2000, price: 1102 };
    const next = appendToParsed({ trades: [ocrA, ocrB], targetPriceUpdates: [], note: 'n' }, row);
    expect(next.trades).toEqual([ocrA, ocrB, row]);
    expect(next.note).toBe('n');
  });

  it('移除最後一列 → null', () => {
    const p = appendToParsed(null, row);
    expect(removeFromParsed(p, 0)).toBeNull();
  });

  it('移除非最後一列 → 保留其餘順序', () => {
    const ocrA = { code: '2454', qty: 1 };
    const p = appendToParsed({ trades: [ocrA], targetPriceUpdates: [], note: '' }, row);
    expect(removeFromParsed(p, 0)?.trades).toEqual([row]);
  });
});

describe('qtyRuleFor / validateManualDraft — TW 整數、US 可碎股', () => {
  it('TW 為 numeric/step=1、整數限制', () => {
    expect(qtyRuleFor('2330')).toMatchObject({ market: 'TW', integerOnly: true, inputMode: 'numeric', step: '1' });
  });

  it('US 為 decimal/step=any、允許碎股', () => {
    expect(qtyRuleFor('AMD')).toMatchObject({ market: 'US', integerOnly: false, inputMode: 'decimal', step: 'any' });
  });

  it('2330 0.5 被擋', () => {
    const errs = validateManualDraft({ ...draft, code: '2330', qty: 0.5 });
    expect(errs.some((e) => e.field === 'qty')).toBe(true);
  });

  it('AMD 0.5 / SOXL 1.25 通過', () => {
    expect(validateManualDraft({ ...draft, code: 'AMD', qty: 0.5 })).toEqual([]);
    expect(validateManualDraft({ ...draft, code: 'SOXL', qty: 1.25 })).toEqual([]);
  });

  it('格式非法代碼 inline error', () => {
    const errs = validateManualDraft({ ...draft, code: '12' });
    expect(errs.find((e) => e.field === 'code')?.message).toContain('格式不正確');
  });

  it('價格需 > 0', () => {
    expect(validateManualDraft({ ...draft, price: 0 }).some((e) => e.field === 'price')).toBe(true);
  });
});

describe('computePreviewIssues — 依序 replay', () => {
  const holdings = [{ code: '2330', qty: 2000 }];

  it('先賣後買不被倒灌（賣超仍判 error）', () => {
    const issues = computePreviewIssues(holdings, [
      { action: '賣出', code: '2330', qty: 3000 },
      { action: '買進', code: '2330', qty: 5000 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'oversell', index: 0, code: '2330', held: 2000, selling: 3000 });
  });

  it('先買後賣則合法', () => {
    const issues = computePreviewIssues(holdings, [
      { action: '買進', code: '2330', qty: 5000 },
      { action: '賣出', code: '2330', qty: 3000 },
    ]);
    expect(issues).toEqual([]);
  });

  it('US fractional 賣超 0.75 > 0.5', () => {
    const issues = computePreviewIssues([{ code: 'AMD', qty: 0.5 }], [
      { action: '賣出', code: 'AMD', qty: 0.75 },
    ]);
    expect(issues[0]).toMatchObject({ kind: 'oversell', code: 'AMD' });
  });

  it('US fractional 合法賣出不報錯', () => {
    expect(computePreviewIssues([{ code: 'SOXL', qty: 1.25 }], [
      { action: '賣出', code: 'SOXL', qty: 1.25 },
    ])).toEqual([]);
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ code: String(1000 + i), qty: 1000 }));

  it(`49 / ${MAX_HOLDINGS} 檔不超限`, () => {
    expect(computePreviewIssues(many(49), [{ action: '買進', code: '9999', qty: 1 }])).toEqual([]);
    expect(computePreviewIssues(many(MAX_HOLDINGS), [])).toEqual([]);
  });

  it(`超過 ${MAX_HOLDINGS} 檔判 max_holdings`, () => {
    const issues = computePreviewIssues(many(MAX_HOLDINGS), [{ action: '買進', code: '9999', qty: 1 }]);
    expect(issues).toEqual([{ kind: 'max_holdings', index: null, overBy: 1 }]);
  });

  it('賣光可釋放名額', () => {
    const issues = computePreviewIssues(many(MAX_HOLDINGS), [
      { action: '賣出', code: '1000', qty: 1000 },
      { action: '買進', code: '9999', qty: 1 },
    ]);
    expect(issues).toEqual([]);
  });

  it('代碼大小寫不影響配對', () => {
    expect(computePreviewIssues([{ code: '00637L', qty: 1000 }], [
      { action: '賣出', code: ' 00637l ', qty: 1000 },
    ])).toEqual([]);
  });
});
