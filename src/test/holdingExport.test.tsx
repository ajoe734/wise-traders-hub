// HoldingExportCard + useHoldingShareExport 測試。
// 守門：尺寸（1080 / 1920）、浮水印 legendflow.tw、stamp、SIMULATED 徽章、
//       PNG 觸發 <a download>、PDF 用 jsPDF 對應 format / 尺寸、copy fallback、錯誤路徑 toast。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import React from 'react';
import HoldingExportCard from '@/checkup/components/freecheckup/HoldingExportCard';
import { useHoldingShareExport } from '@/checkup/hooks/useHoldingShareExport';

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () =>
    // 100×100 透明 PNG 的合法 dataURL（>5KB base64 模擬）
    'data:image/png;base64,' + 'A'.repeat(8000)
  ),
}));

const addImage = vi.fn();
const save = vi.fn();
const jspdfCtor = vi.fn(function (this: any, opts: any) {
  this.opts = opts; this.addImage = addImage; this.save = save;
});
vi.mock('jspdf', () => ({ jsPDF: function (opts: any) { return new (jspdfCtor as any)(opts); } }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const WB = {
  surface: '#F5F3EF', surfaceSoft: '#EEEBE3', ink: '#292520', inkSub: '#403A34',
  inkMute: '#6E665D', inkLight: '#8A857F', hair: '#D9D4CC', accent: '#EC662D',
};
const baseProps = {
  holding: { code: 'TSM', name: '台積電', cost: 600, price: 700, qty: 100 },
  decision: { actionType: 'hold', urgency: 'monitor', actionText: '續抱' },
  meta: { industry: '半導體', strategy: 'AI 主流' },
  scenario: null, baseTarget: 800, pctVal: 16.67, pnlVal: 10000,
  rangeLow: 650, rangeHigh: 720,
  thesis: '長線 AI 龍頭', nextEvent: { date: '2026/07/15', title: '法說', summary: 'Q2 法說會' },
  stamp: '2026/06/27 12:34', WB, showSimulated: false,
  reversalLine: null,
};

describe('HoldingExportCard', () => {
  it('square 渲染 1080×1080 + legendflow.tw + DECISION + stamp', () => {
    const { container } = render(<HoldingExportCard variant="square" {...baseProps} />);
    const root = container.querySelector('[data-export-card]') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-variant')).toBe('square');
    expect(root.style.width).toBe('1080px');
    expect(root.style.height).toBe('1080px');
    expect(screen.getByText(/legendflow/)).toBeInTheDocument();
    expect(screen.getByText('DECISION')).toBeInTheDocument();
    expect(screen.getByText('2026/06/27 12:34')).toBeInTheDocument();
  });

  it('wide 渲染 1920×1080', () => {
    const { container } = render(<HoldingExportCard variant="wide" {...baseProps} />);
    const root = container.querySelector('[data-export-card]') as HTMLElement;
    expect(root.style.width).toBe('1920px');
    expect(root.style.height).toBe('1080px');
    expect(root.getAttribute('data-variant')).toBe('wide');
  });

  it('無轉折訊號時不渲染轉折行（不預留高度）', () => {
    const { container } = render(<HoldingExportCard variant="square" {...baseProps} />);
    expect(container.querySelector('[data-export-reversal]')).toBeNull();
  });

  it('有轉折訊號時帶入同一條精簡文案，footer 不變', () => {
    const line = '轉折觀察 · 低檔放量長下影，站上 3,685.00 才確認';
    const { container } = render(
      <HoldingExportCard variant="square" {...baseProps} reversalLine={line} />,
    );
    expect(container.querySelector('[data-export-reversal]')!.textContent).toContain(line);
    expect(container.querySelector('[data-export-footer]')!.textContent).toContain('也來檢查你的持倉');
  });

  it('不再輸出部位佔比與 SIMULATED 徽章', () => {
    render(<HoldingExportCard variant="square" {...baseProps} />);
    expect(screen.queryByText('SIMULATED')).toBeNull();
    expect(screen.queryByText('部位佔比')).toBeNull();
    expect(screen.getByText('也來檢查你的持倉')).toBeInTheDocument();
  });
});

describe('useHoldingShareExport', () => {
  beforeEach(() => { addImage.mockClear(); save.mockClear(); jspdfCtor.mockClear(); });
  afterEach(() => { vi.clearAllMocks(); });

  function node() {
    const el = document.createElement('div');
    el.textContent = 'fake';
    document.body.appendChild(el);
    return el;
  }

  it('downloadPng 觸發 <a download> 且 href 為 PNG dataURL', async () => {
    const clicks: HTMLAnchorElement[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this as HTMLAnchorElement); };
    const { result } = renderHook(() => useHoldingShareExport({ backgroundColor: '#fff' }));
    await act(async () => { await result.current.downloadPng(node(), 'foo-1x1-20260627.png'); });
    HTMLAnchorElement.prototype.click = origClick;
    expect(clicks.length).toBe(1);
    expect(clicks[0].download).toBe('foo-1x1-20260627.png');
    expect(clicks[0].href.startsWith('data:image/png;base64,')).toBe(true);
    expect(clicks[0].href.length).toBeGreaterThan(5000);
  });

  it('downloadPdf square 使用 [210,210] portrait', async () => {
    const { result } = renderHook(() => useHoldingShareExport({}));
    await act(async () => { await result.current.downloadPdf(node(), 'a.pdf', 'square'); });
    expect(jspdfCtor).toHaveBeenCalledTimes(1);
    const opts = jspdfCtor.mock.calls[0][0];
    expect(opts.format).toEqual([210, 210]);
    expect(opts.orientation).toBe('portrait');
    const args = addImage.mock.calls[0];
    expect(args[2]).toBe(0); expect(args[3]).toBe(0);
    expect(args[4]).toBe(210); expect(args[5]).toBe(210);
    expect(save).toHaveBeenCalledWith('a.pdf');
  });

  it('downloadPdf wide 使用 a4 landscape 並垂直置中', async () => {
    const { result } = renderHook(() => useHoldingShareExport({}));
    await act(async () => { await result.current.downloadPdf(node(), 'b.pdf', 'wide'); });
    const opts = jspdfCtor.mock.calls[0][0];
    expect(opts.format).toBe('a4');
    expect(opts.orientation).toBe('landscape');
    const args = addImage.mock.calls[0];
    expect(args[4]).toBe(297);
    expect(args[5]).toBeCloseTo(297 * 9 / 16, 1);
    expect(args[2]).toBe(0);
    expect(args[3]).toBeCloseTo((210 - 297 * 9 / 16) / 2, 1);
  });

  it('copy 在無 ClipboardItem 時 fallback 到下載', async () => {
    const origCI = (globalThis as any).ClipboardItem;
    delete (globalThis as any).ClipboardItem;
    const clicks: HTMLAnchorElement[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this as HTMLAnchorElement); };
    const { result } = renderHook(() => useHoldingShareExport({}));
    await act(async () => { await result.current.copy(node()); });
    HTMLAnchorElement.prototype.click = origClick;
    if (origCI) (globalThis as any).ClipboardItem = origCI;
    expect(clicks.length).toBe(1);
    expect(clicks[0].href.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('toPng 拋錯時 toast.error 被呼叫，busy 不卡死', async () => {
    const htmlToImage = await import('html-to-image');
    (htmlToImage.toPng as any).mockRejectedValueOnce(new Error('boom'));
    const sonner = await import('sonner');
    const { result } = renderHook(() => useHoldingShareExport({}));
    await act(async () => { await result.current.downloadPng(node(), 'fail.png'); });
    expect(sonner.toast.error).toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });
});
