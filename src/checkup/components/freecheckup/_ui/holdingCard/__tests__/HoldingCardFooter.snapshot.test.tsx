/**
 * HoldingCardFooter — DOM 快照回歸
 *
 * 鎖住 normal/ink × live/screenshot/demo/yclose/null+priceError/null 六種
 * priceSource 分流 + hasToday=false / 負今日損益 / TGT 三情境，共 12 case。
 * 首跑 vitest 會把 markup 寫回 inline snapshot；之後就會 fail-if-diff。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardFooter from '../HoldingCardFooter';

const H_BASE = {
  value: 123456,
  price: 100.5,
  yesterday: 99,
  priceUpdatedAt: '2026-01-01T02:30:00Z',
};

const base = {
  h: H_BASE,
  tp: null,
  upside: null,
  hasToday: true,
  todayPnlNum: 500,
  todayPctNum: 1.23,
  variant: 'normal' as const,
  subColor: '#292520',
  muteColor: '#8A857F',
  hairColor: '#EEEEEE',
  lossColor: '#8A857F',
};

function snap(over: Record<string, unknown> = {}) {
  const { container } = render(<HoldingCardFooter {...base} {...over} />);
  return container.firstChild;
}

describe('HoldingCardFooter — DOM 快照', () => {
  it('#1 normal + live', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'live' } })).toMatchInlineSnapshot();
  });
  it('#2 normal + screenshot (muteColor 支)', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'screenshot' } })).toMatchInlineSnapshot();
  });
  it('#3 normal + demo (lossColor 支)', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'demo' } })).toMatchInlineSnapshot();
  });
  it('#4 normal + yclose (label=昨收)', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'yclose' } })).toMatchInlineSnapshot();
  });
  it('#5 normal + priceError → errBadge=失敗', () => {
    expect(snap({ h: { ...H_BASE, priceSource: null, priceError: '報價逾時' } })).toMatchInlineSnapshot();
  });
  it('#6 normal + 無 source 無 error → 無 badge', () => {
    expect(snap({ h: { ...H_BASE, priceSource: null } })).toMatchInlineSnapshot();
  });

  it('#7 ink + live', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: 'live' } })).toMatchInlineSnapshot();
  });
  it('#8 ink + screenshot', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: 'screenshot' } })).toMatchInlineSnapshot();
  });
  it('#9 ink + priceError → ink errBadge', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: null, priceError: '網路錯誤' } })).toMatchInlineSnapshot();
  });

  it('#10 normal + live + hasToday=false → today=「—」', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'live' }, hasToday: false, todayPnlNum: null, todayPctNum: null })).toMatchInlineSnapshot();
  });
  it('#11 normal + live + 負今日損益（無 + 號）', () => {
    expect(snap({ h: { ...H_BASE, priceSource: 'live' }, todayPnlNum: -800, todayPctNum: -1.23 })).toMatchInlineSnapshot();
  });
  it('#12 ink + live + tp/upside → VALUE 內含 TGT +8.5%', () => {
    expect(snap({ variant: 'ink', h: { ...H_BASE, priceSource: 'live' }, tp: 120, upside: 8.5 })).toMatchInlineSnapshot();
  });
});
