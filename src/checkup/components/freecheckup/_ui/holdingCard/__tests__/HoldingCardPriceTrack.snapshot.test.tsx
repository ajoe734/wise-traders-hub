/**
 * HoldingCardPriceTrack — DOM 快照回歸
 *
 * 鎖住 normal/ink × dec.actionText (無/短/超長) × meta.strategy 分支，
 * 含 truncateAction 標點斷句 + '…' 尾綴、成本/現價 null → '—'，共 8 case。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardPriceTrack from '../HoldingCardPriceTrack';

const H = { cost: 100, price: 123 };
const base = {
  h: H,
  meta: null as any,
  dec: null as any,
  subColor: '#292520',
  muteColor: '#8A857F',
  variant: 'normal' as const,
};

function snap(over: Record<string, unknown> = {}) {
  const { container } = render(<HoldingCardPriceTrack {...base} {...over} />);
  // container.firstChild 為 Fragment 首個 child (rowStyle)，取整包 wrapper 才完整
  return container;
}

const LONG_80 = '這段是超過六十字的操作說明文字，內含逗號、句號。用來測試 truncateAction 是否會在標點處收尾，並補上刪節號結尾，避免尾巴斷在半個詞中間影響閱讀體驗好嗎。';
const LONG_120 = '這段是超過九十字的 ink 卡操作說明，內容較長會被 truncateAction 依照句號斷句收尾，並補上刪節號；目的是驗證 ink variant 的 limit=90 分支能正確處理超長輸入，並且不會因為缺乏標點而落到硬切分支，最終輸出保留閱讀節奏。';

describe('HoldingCardPriceTrack — DOM 快照', () => {
  it('#1 normal + dec.actionText 短句 + strategy', () => {
    expect(snap({ dec: { actionText: '維持持有' }, meta: { strategy: 'STRAT' } })).toMatchInlineSnapshot();
  });
  it('#2 normal + 無 dec → fallback = strategy.slice(0,40)', () => {
    expect(snap({ dec: null, meta: { strategy: 'STRAT' } })).toMatchInlineSnapshot();
  });
  it('#3 normal + 無 dec + 無 strategy → decText 空', () => {
    expect(snap({ dec: null, meta: null })).toMatchInlineSnapshot();
  });
  it('#4 normal + 超長 actionText → 標點斷句 + …', () => {
    expect(snap({ dec: { actionText: LONG_80 }, meta: null })).toMatchInlineSnapshot();
  });

  it('#5 ink + dec + strategy', () => {
    expect(snap({ variant: 'ink', dec: { actionText: '維持持有' }, meta: { strategy: 'STRAT' } })).toMatchInlineSnapshot();
  });
  it('#6 ink + 無 dec + 無 strategy → ink fallback 文案', () => {
    expect(snap({ variant: 'ink', dec: null, meta: null })).toMatchInlineSnapshot();
  });
  it('#7 ink + 超長 actionText → limit=90 截尾', () => {
    expect(snap({ variant: 'ink', dec: { actionText: LONG_120 }, meta: null })).toMatchInlineSnapshot();
  });
  it('#8 normal + h.cost/price=null → 兩處顯示「—」', () => {
    expect(snap({ h: { cost: null, price: null }, dec: { actionText: '維持持有' }, meta: { strategy: 'STRAT' } })).toMatchInlineSnapshot();
  });
});
