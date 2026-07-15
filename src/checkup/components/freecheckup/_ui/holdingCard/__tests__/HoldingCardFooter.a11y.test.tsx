/**
 * HoldingCardFooter — A11y 回歸
 *
 * 覆蓋：
 *   - srcBadge / errBadge 的 aria-label 分流（含 srcTitle 完整內容）。
 *   - 「—」placeholder 的 aria-label="無資料"（today/value 兩處）。
 *   - divider aria-hidden、根節點無 aria-hidden 汙染。
 *   - VALUE / TODAY 純文字 label 仍可被搜尋到。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function mount(over: Record<string, unknown> = {}) {
  return render(<HoldingCardFooter {...base} {...over} />);
}
function getSrcBadge(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="img"][aria-label^="報價來源："]');
}
function getErrBadge(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="img"][aria-label^="報價錯誤："]');
}

describe('HoldingCardFooter — A11y', () => {
  // ─── srcBadge / errBadge aria 分流 ───
  it('#1 live → srcBadge aria-label 含來源/更新/昨收/現價', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: 'live' } });
    const badge = getSrcBadge(container)!;
    expect(badge).not.toBeNull();
    const label = badge.getAttribute('aria-label')!;
    expect(label.startsWith('報價來源：')).toBe(true);
    expect(label).toContain('來源：即時（live）');
    expect(label).toContain('更新於');
    expect(label).toContain('昨收 99.00');
    expect(label).toContain('現價 100.50');
    // 可見文字仍為簡短 label
    expect(badge.textContent).toBe('即時');
  });

  it('#2 screenshot → aria-label 含「來源：截圖（screenshot）」', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: 'screenshot' } });
    expect(getSrcBadge(container)!.getAttribute('aria-label'))
      .toContain('來源：截圖（screenshot）');
  });

  it('#3 demo → aria-label 含「來源：DEMO（demo）」', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: 'demo' } });
    expect(getSrcBadge(container)!.getAttribute('aria-label'))
      .toContain('來源：DEMO（demo）');
  });

  it('#4 yclose → aria-label 含「來源：昨收（yclose）」', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: 'yclose' } });
    expect(getSrcBadge(container)!.getAttribute('aria-label'))
      .toContain('來源：昨收（yclose）');
  });

  it('#5 無 source + priceError → errBadge=「失敗」，aria-label 為報價錯誤，srcBadge 不存在', () => {
    const { container } = mount({
      h: { ...H_BASE, priceSource: null, priceError: '報價逾時' },
    });
    expect(getSrcBadge(container)).toBeNull();
    const err = getErrBadge(container)!;
    expect(err).not.toBeNull();
    expect(err.textContent).toBe('失敗');
    expect(err.getAttribute('aria-label')).toBe('報價錯誤：報價逾時');
    expect(err.getAttribute('title')).toBe('報價逾時');
  });

  it('#6 無 source 無 error → srcBadge / errBadge 皆不存在', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: null } });
    expect(getSrcBadge(container)).toBeNull();
    expect(getErrBadge(container)).toBeNull();
  });

  it('#7 live + priceError → srcTitle 首段=「報價問題：X」，只出現 srcBadge', () => {
    const { container } = mount({
      h: { ...H_BASE, priceSource: 'live', priceError: 'X' },
    });
    const src = getSrcBadge(container)!;
    expect(src.getAttribute('aria-label')).toBe('報價來源：報價問題：X');
    expect(getErrBadge(container)).toBeNull();
  });

  it('#8 ink + live → 仍為 role=img + 完整 aria-label', () => {
    const { container } = mount({
      variant: 'ink',
      h: { ...H_BASE, priceSource: 'live' },
    });
    const badge = getSrcBadge(container)!;
    expect(badge).not.toBeNull();
    expect(badge.getAttribute('role')).toBe('img');
    expect(badge.getAttribute('aria-label')).toContain('來源：即時（live）');
  });

  it('#9 ink + priceError → ink errBadge aria 正確', () => {
    const { container } = mount({
      variant: 'ink',
      h: { ...H_BASE, priceSource: null, priceError: '網路錯誤' },
    });
    expect(getErrBadge(container)!.getAttribute('aria-label'))
      .toBe('報價錯誤：網路錯誤');
  });

  it('#10 live 無 priceUpdatedAt / yesterday → aria-label 不含更新於/昨收，仍含來源/現價', () => {
    const { container } = mount({
      h: { value: 123, price: 100.5, priceSource: 'live' },
    });
    const label = getSrcBadge(container)!.getAttribute('aria-label')!;
    expect(label).toContain('來源：即時（live）');
    expect(label).toContain('現價 100.50');
    expect(label).not.toContain('更新於');
    expect(label).not.toContain('昨收');
  });

  // ─── 「—」placeholder aria ───
  it('#11 hasToday=false → today span aria-label="無資料"', () => {
    const { container } = mount({
      h: { ...H_BASE, priceSource: 'live' },
      hasToday: false,
      todayPnlNum: null,
      todayPctNum: null,
    });
    const dashSpan = container.querySelector('span[aria-label="無資料"]');
    expect(dashSpan).not.toBeNull();
    expect(dashSpan!.textContent).toBe('—');
  });

  it('#12 hasToday=true 但 pnl/pct 皆 null → today 顯示「—」（不強制 aria）', () => {
    const { container } = mount({
      h: { ...H_BASE, priceSource: 'live' },
      todayPnlNum: null,
      todayPctNum: null,
    });
    // today 儲存格內含 '—'
    const todayCell = container.querySelectorAll('.wb-bottom-val')[0];
    expect(todayCell?.textContent).toContain('—');
  });

  it('#13 h.value=null → value 儲存格 aria-label="無資料"', () => {
    const { container } = mount({
      h: { priceSource: 'live', price: 1, yesterday: 1, priceUpdatedAt: null, value: null },
    });
    const valCells = container.querySelectorAll('.wb-bottom-val');
    const valueCell = valCells[valCells.length - 1] as HTMLElement;
    expect(valueCell.textContent).toContain('—');
    expect(valueCell.getAttribute('aria-label')).toBe('無資料');
  });

  it('#14 h.value=123456 → value 儲存格無 aria-label', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: 'live' } });
    const valCells = container.querySelectorAll('.wb-bottom-val');
    const valueCell = valCells[valCells.length - 1] as HTMLElement;
    expect(valueCell.getAttribute('aria-label')).toBeNull();
    expect(valueCell.textContent).toContain('123,456');
  });

  // ─── 結構守門 ───
  it('#15 srcBadge / errBadge 皆不可帶 aria-hidden', () => {
    const { container: c1 } = mount({ h: { ...H_BASE, priceSource: 'live' } });
    expect(getSrcBadge(c1)!.getAttribute('aria-hidden')).toBeNull();
    const { container: c2 } = mount({
      h: { ...H_BASE, priceSource: null, priceError: 'X' },
    });
    expect(getErrBadge(c2)!.getAttribute('aria-hidden')).toBeNull();
  });

  it('#16 根 .wb-bottom 不可帶 aria-hidden="true"（否則整區被 SR 略過）', () => {
    for (const src of ['live', 'screenshot', 'demo', 'yclose', null]) {
      const { container } = mount({
        h: { ...H_BASE, priceSource: src as any, priceError: src ? null : 'X' },
      });
      const root = container.querySelector('.wb-bottom')!;
      expect(root.getAttribute('aria-hidden')).not.toBe('true');
    }
  });

  it('#17 TODAY / VALUE 純文字 label 可被 getByText 找到', () => {
    mount({ h: { ...H_BASE, priceSource: 'live' } });
    expect(screen.getByText('TODAY', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('VALUE', { exact: true })).toBeInTheDocument();
  });

  it('#18 divider 節點帶 aria-hidden="true"（純視覺 1px 線）', () => {
    const { container } = mount({ h: { ...H_BASE, priceSource: 'live' } });
    // divider 為 .wb-bottom 內 grid-column:2 的 div
    const divs = Array.from(container.querySelectorAll('.wb-bottom > div'));
    const divider = divs.find((d) => d.getAttribute('aria-hidden') === 'true');
    expect(divider, 'divider 應帶 aria-hidden="true"').not.toBeUndefined();
  });
});
