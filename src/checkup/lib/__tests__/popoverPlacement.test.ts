import { describe, it, expect } from 'vitest';
import { placePopover, popoverMaxWidth } from '../popoverPlacement';

const bounds = { left: 0, right: 800, top: 0, bottom: 600 };

describe('popoverMaxWidth', () => {
  it('桌機上限 240px', () => {
    expect(popoverMaxWidth(1280)).toBe(240);
  });
  it('手機為 viewport - 24px', () => {
    expect(popoverMaxWidth(390)).toBe(240);
    expect(popoverMaxWidth(250)).toBe(226);
  });
  it('極窄仍保底 160px，避免文字被壓成一字一行', () => {
    expect(popoverMaxWidth(120)).toBe(160);
  });
});

describe('placePopover', () => {
  it('預設放上方並水平置中於 anchor', () => {
    const p = placePopover({
      anchor: { x: 400, top: 300, bottom: 312 },
      size: { width: 240, height: 130 },
      bounds,
    });
    expect(p.placement).toBe('above');
    expect(p.top).toBe(300 - 8 - 130);
    expect(p.left).toBe(280);
  });

  it('上方空間不足時翻到下方', () => {
    const p = placePopover({
      anchor: { x: 400, top: 20, bottom: 32 },
      size: { width: 240, height: 130 },
      bounds,
    });
    expect(p.placement).toBe('below');
    expect(p.top).toBe(40);
  });

  it('貼左緣時夾在容器內（不產生負值 / 不裁切）', () => {
    const p = placePopover({
      anchor: { x: 4, top: 300, bottom: 312 },
      size: { width: 240, height: 130 },
      bounds,
    });
    expect(p.left).toBe(0);
  });

  it('貼右緣時右邊界對齊容器（不產生水平捲軸）', () => {
    const p = placePopover({
      anchor: { x: 798, top: 300, bottom: 312 },
      size: { width: 240, height: 130 },
      bounds,
    });
    expect(p.left + 240).toBeLessThanOrEqual(bounds.right);
    expect(p.left).toBe(560);
  });

  it('容器比 popover 還窄時仍夾在左邊界，不外溢', () => {
    const p = placePopover({
      anchor: { x: 100, top: 300, bottom: 312 },
      size: { width: 240, height: 130 },
      bounds: { left: 50, right: 200, top: 0, bottom: 600 },
    });
    expect(p.left).toBe(50);
  });

  it('上下都塞不下時夾在可視範圍內，不出界', () => {
    const p = placePopover({
      anchor: { x: 400, top: 10, bottom: 190 },
      size: { width: 240, height: 190 },
      bounds: { left: 0, right: 800, top: 0, bottom: 200 },
    });
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + 190).toBeLessThanOrEqual(200);
  });
});
