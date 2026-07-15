/**
 * HoldingCard 子元件 — 派生樣式/字串「引用穩定性」測試。
 *
 * 目的：透過 mock `React.useMemo` 記錄每次 render 的所有 memo 產出，
 *      在「非相關 props 變動」或「identical rerender」時，確認 memoized
 *      值（樣式物件、派生字串）維持 Object.is 相同引用，保證下游 DOM
 *      diff / React.memo 子樹重渲染都能命中 bailout。
 *
 * 覆蓋元件：HoldingCardHeader / HoldingCardReturn / HoldingCardPriceTrack / HoldingCardFooter。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

// ---- 全域 memo 攔截 ----
// vi.mock 於模組載入時 hoist；useMemo 被替換為透明 wrapper，收錄結果引用。
vi.mock('react', async () => {
  const actual: any = await vi.importActual('react');
  return {
    ...actual,
    useMemo: (factory: any, deps: any) => {
      const v = actual.useMemo(factory, deps);
      (globalThis as any).__memoLog.push(v);
      return v;
    },
  };
});

(globalThis as any).__memoLog = [];
const memoLog: unknown[] = (globalThis as any).__memoLog;

// 於每個 render pass 前/後 snapshot log；比對第 N 個 useMemo 是否引用相同
function assertAllMemosStable(
  fn: () => void,
  fn2: () => void,
): void {
  memoLog.length = 0;
  fn();
  const first = memoLog.slice();
  const n = first.length;
  fn2();
  const second = memoLog.slice(n);
  expect(second.length).toBe(n);
  for (let i = 0; i < n; i++) {
    // 若某項 memo 引用不同，回報索引以利定位（哪個 useMemo 失效）
    if (!Object.is(first[i], second[i])) {
      throw new Error(
        `memo #${i} 引用改變：before=${describe_(first[i])} after=${describe_(second[i])}`,
      );
    }
  }
}

// 描述 memo 值型別以利偵錯輸出
function describe_(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'function') return 'fn';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'object') return `obj{${Object.keys(v as object).join(',')}}`;
  return `${typeof v}:${String(v).slice(0, 40)}`;
}

// 允許自訂「哪些 index 可以改變」（被相關 prop 觸發更新）
function assertMemosStableExcept(
  fn: () => void,
  fn2: () => void,
  allowChangeIndexes: number[],
): void {
  memoLog.length = 0;
  fn();
  const first = memoLog.slice();
  const n = first.length;
  fn2();
  const second = memoLog.slice(n);
  expect(second.length).toBe(n);
  for (let i = 0; i < n; i++) {
    const changed = !Object.is(first[i], second[i]);
    if (allowChangeIndexes.includes(i)) continue;
    if (changed) {
      throw new Error(
        `memo #${i} 意外變動：before=${describe_(first[i])} after=${describe_(second[i])}`,
      );
    }
  }
}

beforeEach(() => {
  memoLog.length = 0;
});

// ==================================================================
// HoldingCardHeader
// ==================================================================
import HoldingCardHeader from '../HoldingCardHeader';

const HEADER_H = { code: '2330', name: '台積電', qty: 1000 };
const HEADER_META = { industries: ['半導體', 'AI'], strategy: '長線' };
const HEADER_SPARK = [100, 101, 102, 103, 104];

const headerProps = (over: Record<string, unknown> = {}) => ({
  h: HEADER_H,
  meta: HEADER_META,
  onReportMeta: undefined,
  variant: 'normal' as const,
  cardColor: '#292520',
  muteColor: '#8A857F',
  sparkData: HEADER_SPARK,
  sparkFailed: false,
  actionLabel: 'HOLD',
  pctVal: 5,
  // sentinel：每次呼叫都是新引用，強制 React.memo 通過並觸發 re-render，
  // 讓 useMemo 有機會執行以驗證 deps 未變時的 bailout。
  __k: {},
  ...over,
});

describe('HoldingCardHeader — 引用穩定性', () => {
  it('identical rerender（same-ref props）→ 全部 useMemo 引用不變', () => {
    const { rerender } = render(<HoldingCardHeader {...headerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardHeader {...headerProps()} />),
      () => rerender(<HoldingCardHeader {...headerProps()} />),
    );
  });

  it('pctVal 由 5 → 8（同號正）→ sparkColor / sparkOpacity 引用不變（key=sign）', () => {
    const { rerender } = render(<HoldingCardHeader {...headerProps({ pctVal: 5 })} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardHeader {...headerProps({ pctVal: 5 })} />),
      () => rerender(<HoldingCardHeader {...headerProps({ pctVal: 8 })} />),
    );
  });

  it('sparkData 內容變動（新陣列，相同 sign）→ palette / industries / sparkColor / sparkOpacity 全數穩定', () => {
    const { rerender } = render(<HoldingCardHeader {...headerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardHeader {...headerProps()} />),
      () => rerender(
        <HoldingCardHeader
          {...headerProps({ sparkData: [200, 201, 202, 203] })}
        />,
      ),
    );
  });

  it('actionLabel 變動（HOLD → BUY）→ 全 useMemo 穩定（無 memo 依賴 actionLabel）', () => {
    const { rerender } = render(<HoldingCardHeader {...headerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardHeader {...headerProps({ actionLabel: 'HOLD' })} />),
      () => rerender(<HoldingCardHeader {...headerProps({ actionLabel: 'BUY' })} />),
    );
  });

  it('meta 保持同引用 + 其他 props 變 → industries 引用不變', () => {
    const { rerender } = render(<HoldingCardHeader {...headerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardHeader {...headerProps({ cardColor: '#292520' })} />),
      () => rerender(<HoldingCardHeader {...headerProps({ cardColor: '#111111' })} />),
    );
  });
});

// ==================================================================
// HoldingCardReturn
// ==================================================================
import HoldingCardReturn from '../HoldingCardReturn';

const returnProps = (over: Record<string, unknown> = {}) => ({
  pctVal: 5,
  pnlVal: 12345,
  pnlColor: '#FF4D1F',
  pnlWeight: 500,
  pnlArrow: '↑',
  subColor: '#555555',
  variant: 'normal' as const,
  __k: {},
  ...over,
});

describe('HoldingCardReturn — 引用穩定性', () => {
  it('identical rerender → variantStyle / rowStyle / roiStyle / pnlSubStyle 全部穩定', () => {
    const { rerender } = render(<HoldingCardReturn {...returnProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardReturn {...returnProps()} />),
      () => rerender(<HoldingCardReturn {...returnProps()} />),
    );
  });

  it('pctVal 變動（5 → 10）→ 全 useMemo 穩定（無 memo 依賴 pctVal）', () => {
    const { rerender } = render(<HoldingCardReturn {...returnProps({ pctVal: 5 })} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardReturn {...returnProps({ pctVal: 5 })} />),
      () => rerender(<HoldingCardReturn {...returnProps({ pctVal: 10 })} />),
    );
  });

  it('pnlVal 變動 → 全 useMemo 穩定（無 memo 依賴 pnlVal）', () => {
    const { rerender } = render(<HoldingCardReturn {...returnProps({ pnlVal: 100 })} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardReturn {...returnProps({ pnlVal: 100 })} />),
      () => rerender(<HoldingCardReturn {...returnProps({ pnlVal: 99999 })} />),
    );
  });

  it('pnlArrow 變動（↑ → ↓）→ 全 useMemo 穩定', () => {
    const { rerender } = render(<HoldingCardReturn {...returnProps({ pnlArrow: '↑' })} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardReturn {...returnProps({ pnlArrow: '↑' })} />),
      () => rerender(<HoldingCardReturn {...returnProps({ pnlArrow: '↓' })} />),
    );
  });

  it('pnlColor 變動 → 只 roiStyle 可變；variantStyle / rowStyle / pnlSubStyle 穩定', () => {
    // 已知 useMemo 順序：0=variantStyle, 1=rowStyle, 2=roiStyle, 3=pnlSubStyle
    const { rerender } = render(<HoldingCardReturn {...returnProps({ pnlColor: '#FF4D1F' })} />);
    assertMemosStableExcept(
      () => rerender(<HoldingCardReturn {...returnProps({ pnlColor: '#FF4D1F' })} />),
      () => rerender(<HoldingCardReturn {...returnProps({ pnlColor: '#00AA55' })} />),
      [2],
    );
  });

  it('subColor 變動 → 只 pnlSubStyle 可變；其餘穩定', () => {
    const { rerender } = render(<HoldingCardReturn {...returnProps({ subColor: '#555' })} />);
    assertMemosStableExcept(
      () => rerender(<HoldingCardReturn {...returnProps({ subColor: '#555' })} />),
      () => rerender(<HoldingCardReturn {...returnProps({ subColor: '#999' })} />),
      [3],
    );
  });
});

// ==================================================================
// HoldingCardPriceTrack
// ==================================================================
import HoldingCardPriceTrack from '../HoldingCardPriceTrack';

const PT_H = { cost: 100, price: 123 };
const PT_META = { strategy: 'STRAT' };
const PT_DEC = { actionText: '維持持有' };

const priceTrackProps = (over: Record<string, unknown> = {}) => ({
  h: PT_H,
  meta: PT_META,
  dec: PT_DEC,
  subColor: '#333',
  muteColor: '#888',
  variant: 'normal' as const,
  __k: {},
  ...over,
});

describe('HoldingCardPriceTrack — 引用穩定性', () => {
  it('identical rerender → 全 useMemo 穩定', () => {
    const { rerender } = render(<HoldingCardPriceTrack {...priceTrackProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardPriceTrack {...priceTrackProps()} />),
      () => rerender(<HoldingCardPriceTrack {...priceTrackProps()} />),
    );
  });

  it('h.price 變動（tick）但 h.cost 不變 → costStr / rowStyle / labelStyle / arrowStyle / decWrapStyle / decTextStyle / decText 穩定', () => {
    // memo 順序：0=decText, 1=costStr, 2=priceStr, 3=rowStyle, 4=labelStyle,
    //           5=arrowStyle, 6=decWrapStyle, 7=decTextStyle
    // 僅 priceStr(2) 可變
    const { rerender } = render(
      <HoldingCardPriceTrack {...priceTrackProps({ h: { cost: 100, price: 123 } })} />,
    );
    assertMemosStableExcept(
      () => rerender(
        <HoldingCardPriceTrack {...priceTrackProps({ h: { cost: 100, price: 123 } })} />,
      ),
      () => rerender(
        <HoldingCardPriceTrack {...priceTrackProps({ h: { cost: 100, price: 999 } })} />,
      ),
      [2],
    );
  });

  it('h.cost 變動但 h.price 不變 → 僅 costStr(1) 可變', () => {
    const { rerender } = render(
      <HoldingCardPriceTrack {...priceTrackProps({ h: { cost: 100, price: 123 } })} />,
    );
    assertMemosStableExcept(
      () => rerender(
        <HoldingCardPriceTrack {...priceTrackProps({ h: { cost: 100, price: 123 } })} />,
      ),
      () => rerender(
        <HoldingCardPriceTrack {...priceTrackProps({ h: { cost: 88, price: 123 } })} />,
      ),
      [1],
    );
  });

  it('dec.actionText 相同（新物件參考）→ decText 穩定（依賴 actionText 值而非 dec 引用）', () => {
    const { rerender } = render(<HoldingCardPriceTrack {...priceTrackProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardPriceTrack {...priceTrackProps({ dec: { actionText: '維持持有' } })} />),
      () => rerender(<HoldingCardPriceTrack {...priceTrackProps({ dec: { actionText: '維持持有' } })} />),
    );
  });

  it('meta.strategy 內容不變但 meta 為新物件 → 全 useMemo 穩定', () => {
    const { rerender } = render(<HoldingCardPriceTrack {...priceTrackProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardPriceTrack {...priceTrackProps({ meta: { strategy: 'STRAT' } })} />),
      () => rerender(<HoldingCardPriceTrack {...priceTrackProps({ meta: { strategy: 'STRAT' } })} />),
    );
  });
});

// ==================================================================
// HoldingCardFooter
// ==================================================================
import HoldingCardFooter from '../HoldingCardFooter';

const FT_H = {
  value: 123456,
  price: 100,
  priceSource: 'live',
  priceUpdatedAt: '2026-01-01T00:00:00Z',
  yesterday: 95,
};

const footerProps = (over: Record<string, unknown> = {}) => ({
  h: FT_H,
  tp: null,
  upside: null,
  hasToday: true,
  todayPnlNum: 500,
  todayPctNum: 1.23,
  variant: 'normal' as const,
  subColor: '#333',
  muteColor: '#888',
  hairColor: '#eeeeee',
  lossColor: '#8A857F',
  __k: {},
  ...over,
});

describe('HoldingCardFooter — 引用穩定性', () => {
  it('identical rerender → 全 useMemo 穩定（含 srcLabel / srcTitle / srcBadge / errBadge / containerStyle / valueStr / todayNode / tgtStr）', () => {
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardFooter {...footerProps()} />),
      () => rerender(<HoldingCardFooter {...footerProps()} />),
    );
  });

  it('tp / upside 變動（normal variant，showTgt=false）→ 全 useMemo 穩定', () => {
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardFooter {...footerProps({ tp: 100, upside: 5 })} />),
      () => rerender(<HoldingCardFooter {...footerProps({ tp: 200, upside: 15 })} />),
    );
  });

  it('h 為新物件但關鍵欄位皆同值 → srcLabel / srcTitle / valueStr 全穩定', () => {
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertAllMemosStable(
      () => rerender(<HoldingCardFooter {...footerProps({ h: { ...FT_H } })} />),
      () => rerender(<HoldingCardFooter {...footerProps({ h: { ...FT_H } })} />),
    );
  });

  it('todayPnlNum 變動 → 僅 todayNode 可變；containerStyle / valCellStyle / srcBadge / errBadge / valueStr 穩定', () => {
    // memo 順序：0=srcLabel 1=srcTitle 2=srcBadge 3=errBadge 4=containerStyle
    //           5=headerCellStyle 6=dividerStyle 7=valCellStyle 8=todayPctStyle
    //           9=todayNode 10=valueStr 11=tgtStr
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertMemosStableExcept(
      () => rerender(<HoldingCardFooter {...footerProps({ todayPnlNum: 500 })} />),
      () => rerender(<HoldingCardFooter {...footerProps({ todayPnlNum: 999 })} />),
      [9],
    );
  });

  it('todayPctNum 變動 → 僅 todayNode(9) 可變', () => {
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertMemosStableExcept(
      () => rerender(<HoldingCardFooter {...footerProps({ todayPctNum: 1.23 })} />),
      () => rerender(<HoldingCardFooter {...footerProps({ todayPctNum: -0.5 })} />),
      [9],
    );
  });

  it('h.value 變動但 priceSource 等不變 → 僅 valueStr(10) 可變', () => {
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertMemosStableExcept(
      () => rerender(<HoldingCardFooter {...footerProps({ h: { ...FT_H, value: 123456 } })} />),
      () => rerender(<HoldingCardFooter {...footerProps({ h: { ...FT_H, value: 987654 } })} />),
      [10],
    );
  });

  it('hairColor 變動 → 僅 containerStyle(4) / dividerStyle(6) 可變；srcBadge / valueStr / todayNode 穩定', () => {
    const { rerender } = render(<HoldingCardFooter {...footerProps()} />);
    assertMemosStableExcept(
      () => rerender(<HoldingCardFooter {...footerProps({ hairColor: '#eeeeee' })} />),
      () => rerender(<HoldingCardFooter {...footerProps({ hairColor: '#ffffff' })} />),
      [4, 6],
    );
  });
});
