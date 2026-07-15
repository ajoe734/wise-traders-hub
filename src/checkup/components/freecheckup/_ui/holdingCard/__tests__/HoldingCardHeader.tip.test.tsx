/**
 * HoldingCardHeader — per-signal 教學徽章 (.wb-tip) 測試
 *
 * 覆蓋：
 *   1. getFallbackTip 分流表（英/中/未知/空字串）窮舉。
 *   2. 徽章文字/來源/aria-label/opacity 在 meta 提供與 fallback 兩情境正確。
 *   3. meta.tips[] 多值 → 主文=[0]，title 換行包含全部。
 *   4. 卡片外層 aria-label 不受本次注入影響（守門）。
 *   5. industries/strategy/onReportMeta 皆缺時仍渲染 .wb-tags + .wb-tip。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingCardHeader, { getFallbackTip } from '../HoldingCardHeader';

const base = {
  h: { code: '2330', name: '台積電', qty: 1000, unit: '股' },
  meta: null as any,
  onReportMeta: undefined,
  variant: 'normal' as const,
  cardColor: '#000',
  muteColor: '#888',
  sparkData: [],
  sparkFailed: false,
  actionLabel: 'HOLD',
  pctVal: 5,
};

describe('getFallbackTip — 分流窮舉', () => {
  const cases: Array<[string, string]> = [
    ['ADD', '進場前先確認風險比例'],
    ['BUY', '進場前先確認風險比例'],
    ['加碼', '進場前先確認風險比例'],
    ['買進', '進場前先確認風險比例'],
    ['REDUCE', '分批減碼保留紀律'],
    ['SELL', '分批減碼保留紀律'],
    ['減碼', '分批減碼保留紀律'],
    ['賣出', '分批減碼保留紀律'],
    ['HOLD', '續抱請設好停損'],
    ['hold', '續抱請設好停損'],
    ['續抱', '續抱請設好停損'],
    ['', '持倉檢視小提醒'],
    ['EXIT', '持倉檢視小提醒'],
    ['REVIEW', '持倉檢視小提醒'],
  ];
  it.each(cases)('actionLabel=%s → %s', (input, expected) => {
    expect(getFallbackTip(input)).toBe(expected);
  });
  it('null / undefined 皆走預設', () => {
    expect(getFallbackTip(undefined as any)).toBe('持倉檢視小提醒');
    expect(getFallbackTip(null as any)).toBe('持倉檢視小提醒');
  });
});

describe('HoldingCardHeader — .wb-tip 徽章渲染', () => {
  function findTip(container: HTMLElement): HTMLElement {
    const el = container.querySelector('.wb-tip') as HTMLElement | null;
    if (!el) throw new Error('.wb-tip not rendered');
    return el;
  }

  it('meta.tip 提供 → source=meta、文字/aria-label 使用 meta.tip、opacity=1', () => {
    const { container } = render(
      <HoldingCardHeader {...base} meta={{ tip: '自訂A' }} />
    );
    const tip = findTip(container);
    expect(tip.textContent).toBe('自訂A');
    expect(tip.getAttribute('data-tip-source')).toBe('meta');
    expect(tip.getAttribute('aria-label')).toBe('教學提示：自訂A');
    expect(tip.getAttribute('data-tip-action')).toBe('HOLD');
    expect(tip.style.opacity).toBe('1');
  });

  it('meta.tips=[A,B,C] → 主文=A、title 含 A\\nB\\nC、source=meta', () => {
    const { container } = render(
      <HoldingCardHeader {...base} meta={{ tips: ['A', 'B', 'C'] }} />
    );
    const tip = findTip(container);
    expect(tip.textContent).toBe('A');
    expect(tip.getAttribute('title')).toBe('A\nB\nC');
    expect(tip.getAttribute('data-tip-source')).toBe('meta');
  });

  it('meta.tip 與 meta.tips 同時提供 → tip 為主、tips 全數附在 title', () => {
    const { container } = render(
      <HoldingCardHeader {...base} meta={{ tip: 'main', tips: ['x', 'y'] }} />
    );
    const tip = findTip(container);
    expect(tip.textContent).toBe('main');
    expect(tip.getAttribute('title')).toBe('main\nx\ny');
  });

  it('meta 缺、actionLabel=ADD → fallback「進場前先確認風險比例」、opacity=0.7', () => {
    const { container } = render(
      <HoldingCardHeader {...base} meta={null} actionLabel="ADD" />
    );
    const tip = findTip(container);
    expect(tip.textContent).toBe('進場前先確認風險比例');
    expect(tip.getAttribute('data-tip-source')).toBe('fallback');
    expect(tip.getAttribute('data-tip-action')).toBe('ADD');
    expect(tip.style.opacity).toBe('0.7');
  });

  it('meta={}、actionLabel="" → fallback「持倉檢視小提醒」', () => {
    const { container } = render(
      <HoldingCardHeader {...base} meta={{}} actionLabel="" />
    );
    const tip = findTip(container);
    expect(tip.textContent).toBe('持倉檢視小提醒');
    expect(tip.getAttribute('data-tip-source')).toBe('fallback');
  });

  it('meta.tip 為空字串 → 走 fallback', () => {
    const { container } = render(
      <HoldingCardHeader {...base} meta={{ tip: '   ' }} actionLabel="SELL" />
    );
    const tip = findTip(container);
    expect(tip.textContent).toBe('分批減碼保留紀律');
    expect(tip.getAttribute('data-tip-source')).toBe('fallback');
  });

  it('industries / strategy / onReportMeta 皆缺 → .wb-tags 容器仍渲染且含 .wb-tip', () => {
    const { container } = render(<HoldingCardHeader {...base} meta={null} />);
    expect(container.querySelector('.wb-tags')).not.toBeNull();
    expect(container.querySelector('.wb-tip')).not.toBeNull();
  });

  it('卡片外層 aria-label 由父層控制、Header 不設 → 注入 tip 前後父層 aria 不變（守門）', () => {
    const Wrap = ({ withTip }: { withTip: boolean }) => (
      <article aria-label="卡片父層 2330">
        <HoldingCardHeader
          {...base}
          meta={withTip ? { tip: '教學片段' } : null}
        />
      </article>
    );
    const { container, rerender } = render(<Wrap withTip={false} />);
    const before = container.querySelector('article')!.getAttribute('aria-label');
    rerender(<Wrap withTip={true} />);
    const after = container.querySelector('article')!.getAttribute('aria-label');
    expect(after).toBe(before);
    expect(after).toBe('卡片父層 2330');
  });
});
