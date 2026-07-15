/**
 * exportJournalPdf.actionMeta ↔ ActionBadge 對應合約測試
 *
 * PDF 匯出的 action 徽章顏色/中文標籤，必須與畫面 ActionBadge 完全一致，
 * 否則使用者匯出的週記 PDF 會出現「螢幕綠色買進 vs PDF 紅色買進」這種災難。
 *
 * 覆蓋範圍：
 *   - 5 個 SignalAction 值 (buy/sell/add/trim/exit)
 *   - 英文 key（DB 內存值）+ 中文 label（前台顯示值）雙輸入
 *   - 大小寫容錯 / 前後空白
 *   - 未知 action fallback
 *   - 空字串 / null-like fallback → 'HOLD'
 *   - 與 ActionBadge.actionConfig 的中文 label 完全一致
 *   - 台股慣例：買/加 = 紅色系（漲），賣 = 綠色系（跌）— 顏色語意不能對調
 */
import { describe, it, expect } from 'vitest';
import { actionMeta } from '@/lib/exportJournalPdf';

// 期望的 5 種 action 顏色/中文（與 src/components/ActionBadge.tsx 對齊）
type Expect = { label: string; bg: string; fg: string };
const EXPECT: Record<'buy' | 'sell' | 'add' | 'trim' | 'exit', Expect> = {
  buy:  { label: '買進', bg: '#D94848', fg: '#FFFFFF' },
  sell: { label: '賣出', bg: '#2E8B57', fg: '#FFFFFF' },
  add:  { label: '加碼', bg: '#3B82F6', fg: '#FFFFFF' },
  trim: { label: '減碼', bg: '#F59E0B', fg: '#FFFFFF' },
  exit: { label: '平損', bg: '#64748B', fg: '#FFFFFF' },
};

describe('exportJournalPdf · actionMeta', () => {
  describe('英文 key（DB action 欄位）', () => {
    (Object.keys(EXPECT) as Array<keyof typeof EXPECT>).forEach((key) => {
      it(`"${key}" → ${EXPECT[key].label} / ${EXPECT[key].bg}`, () => {
        expect(actionMeta(key)).toEqual(EXPECT[key]);
      });
    });
  });

  describe('中文 label（前台顯示值）', () => {
    (Object.keys(EXPECT) as Array<keyof typeof EXPECT>).forEach((key) => {
      const zh = EXPECT[key].label;
      it(`"${zh}" → ${zh} / ${EXPECT[key].bg}`, () => {
        expect(actionMeta(zh)).toEqual(EXPECT[key]);
      });
    });
  });

  describe('容錯：大小寫 / 前後空白', () => {
    it.each([
      ['BUY', EXPECT.buy],
      ['Buy', EXPECT.buy],
      [' buy ', EXPECT.buy],
      ['SELL', EXPECT.sell],
      ['Add', EXPECT.add],
      ['TRIM', EXPECT.trim],
      ['Exit', EXPECT.exit],
      [' 買進 ', EXPECT.buy],
      [' 平損 ', EXPECT.exit],
    ])('actionMeta(%p) 正規化正確', (input, expected) => {
      expect(actionMeta(input as string)).toEqual(expected);
    });
  });

  describe('fallback', () => {
    it('未知字串 → label 保留原字串、灰底白字', () => {
      const r = actionMeta('unknown-action');
      expect(r.label).toBe('unknown-action');
      expect(r.bg).toBe('#8A857C'); // COLORS.gray
      expect(r.fg).toBe('#FFFFFF');
    });

    it('空字串 → label 為 "HOLD"', () => {
      const r = actionMeta('');
      expect(r.label).toBe('HOLD');
      expect(r.bg).toBe('#8A857C');
      expect(r.fg).toBe('#FFFFFF');
    });

    it('null / undefined → label 為 "HOLD"，不會 throw', () => {
      expect(() => actionMeta(null as any)).not.toThrow();
      expect(() => actionMeta(undefined as any)).not.toThrow();
      expect(actionMeta(null as any).label).toBe('HOLD');
      expect(actionMeta(undefined as any).label).toBe('HOLD');
    });

    it('全空白 → label 為 "HOLD"', () => {
      expect(actionMeta('   ').label).toBe('HOLD');
    });
  });

  describe('語意守門：台股顏色慣例（紅漲綠跌）不可對調', () => {
    // 台股/亞股顏色慣例：買進=紅、賣出=綠。歐美習慣相反，PDF 匯出必須用台股版。
    it('buy 是紅色系（不能綠）', () => {
      expect(actionMeta('buy').bg).toBe('#D94848');
      expect(actionMeta('buy').bg).not.toBe('#2E8B57');
    });
    it('sell 是綠色系（不能紅）', () => {
      expect(actionMeta('sell').bg).toBe('#2E8B57');
      expect(actionMeta('sell').bg).not.toBe('#D94848');
    });
    it('add 加碼視為買方向：藍色（不能綠）', () => {
      expect(actionMeta('add').bg).toBe('#3B82F6');
      expect(actionMeta('add').bg).not.toBe('#2E8B57');
    });
    it('trim 減碼視為賣方向：琥珀色（不能紅）', () => {
      expect(actionMeta('trim').bg).toBe('#F59E0B');
      expect(actionMeta('trim').bg).not.toBe('#D94848');
    });
    it('exit 平倉：中性板岩灰', () => {
      expect(actionMeta('exit').bg).toBe('#64748B');
    });
  });

  describe('foreground 對比守門', () => {
    it.each(['buy', 'sell', 'add', 'trim', 'exit', 'unknown', ''] as const)(
      'actionMeta(%p).fg 為白色（暗底 + 白字，AA 對比）',
      (a) => {
        expect(actionMeta(a).fg).toBe('#FFFFFF');
      },
    );
  });

  describe('鏡像 ActionBadge.actionConfig（單一真源）', () => {
    // 若 src/components/ActionBadge.tsx 改中文 label，這裡會炸，強迫同步。
    it('5 個 SignalAction 的中文 label 與 ActionBadge 一致', () => {
      expect(actionMeta('buy').label).toBe('買進');
      expect(actionMeta('sell').label).toBe('賣出');
      expect(actionMeta('add').label).toBe('加碼');
      expect(actionMeta('trim').label).toBe('減碼');
      expect(actionMeta('exit').label).toBe('平損');
    });

    it('中文 label 反向查表也走同一條規則（雙向對稱）', () => {
      (['買進', '賣出', '加碼', '減碼', '平損'] as const).forEach((zh) => {
        const byZh = actionMeta(zh);
        expect(byZh.label).toBe(zh);
      });
    });
  });
});
