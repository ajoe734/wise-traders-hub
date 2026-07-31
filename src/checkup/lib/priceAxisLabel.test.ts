import { describe, it, expect } from 'vitest';
import {
  estimateLabelWidth,
  resolveMaxWidth,
  resolveLabelBox,
  assignLanes,
  laneTopOffset,
  LABEL_MIN_MAX_WIDTH,
  LABEL_MAX_MAX_WIDTH,
  isCompactPriceAxis,
  resolveTrackMetrics,
  toCompactRow,
  PRICE_AXIS_COMPACT_MAX_TRACK,
} from './priceAxisLabel';

describe('estimateLabelWidth', () => {
  it('空字串為 0', () => {
    expect(estimateLabelWidth('')).toBe(0);
  });

  it('中文字比數字寬', () => {
    expect(estimateLabelWidth('成本')).toBeGreaterThan(estimateLabelWidth('12'));
  });

  it('字串越長估寬越大（單調遞增）', () => {
    const a = estimateLabelWidth('成本 507.00');
    const b = estimateLabelWidth('成本 1,507.00');
    const c = estimateLabelWidth('目標 1,507.00 ↓12%');
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe('resolveMaxWidth', () => {
  it('窄容器夾在下限', () => {
    expect(resolveMaxWidth(120)).toBe(LABEL_MIN_MAX_WIDTH);
  });
  it('寬容器夾在上限', () => {
    expect(resolveMaxWidth(2000)).toBe(LABEL_MAX_MAX_WIDTH);
  });
  it('中間值隨容器縮放', () => {
    const w = resolveMaxWidth(220);
    expect(w).toBeGreaterThan(LABEL_MIN_MAX_WIDTH);
    expect(w).toBeLessThan(LABEL_MAX_MAX_WIDTH);
  });
  it('非法輸入退回預設 320 的比例', () => {
    expect(resolveMaxWidth(NaN)).toBe(resolveMaxWidth(320));
  });
});

describe('resolveLabelBox', () => {
  const containerWidth = 360;

  it('置中標籤維持 translateX(-50%)', () => {
    const box = resolveLabelBox({ text: '現價 512.00', lxPct: 50, containerWidth });
    expect(box.anchor).toBe('center');
    expect(box.transform).toBe('translateX(-50%)');
  });

  it('靠左標籤改為貼齊左緣，不越界', () => {
    const box = resolveLabelBox({ text: '成本 1,507.00', lxPct: 2, containerWidth });
    expect(box.anchor).toBe('start');
    expect(box.left).toBe('0px');
    expect(box.transform).toBe('none');
  });

  it('靠右標籤改為貼齊右緣，不越界', () => {
    const box = resolveLabelBox({ text: '目標 1,507.00 ↓12%', lxPct: 99, containerWidth });
    expect(box.anchor).toBe('end');
    expect(box.left).toBe(`${containerWidth}px`);
    expect(box.transform).toBe('translateX(-100%)');
  });

  it('短標籤在中段能真正對準刻度（不被固定半寬 clamp 拉開）', () => {
    const box = resolveLabelBox({ text: '現價 9.00', lxPct: 30, containerWidth });
    expect(box.anchor).toBe('center');
    expect(box.left).toBe('108px');
  });

  it('超過 maxWidth 的字串改成兩行', () => {
    const box = resolveLabelBox({ text: '目標 12,345.00 ↓12% 台積電成分股', lxPct: 50, containerWidth });
    expect(box.wrap).toBe(true);
    expect(box.lines).toBe(2);
  });

  it('短字串不換行', () => {
    const box = resolveLabelBox({ text: '成本 50', lxPct: 50, containerWidth });
    expect(box.wrap).toBe(false);
    expect(box.lines).toBe(1);
  });

  it('任何 lx 都不會讓渲染區間超出容器', () => {
    for (const lx of [0, 1, 8, 25, 50, 75, 92, 99, 100]) {
      for (const text of ['成本 8', '目標 1,234.56 ↓12%', '現價 12,345.00']) {
        const box = resolveLabelBox({ text, lxPct: lx, containerWidth });
        const width = Math.min(box.estWidth, box.maxWidth);
        const leftPx = parseFloat(box.left);
        const renderedLeft =
          box.anchor === 'start' ? leftPx : box.anchor === 'end' ? leftPx - width : leftPx - width / 2;
        expect(renderedLeft).toBeGreaterThanOrEqual(-0.01);
        expect(renderedLeft + width).toBeLessThanOrEqual(containerWidth + 0.01);
      }
    }
  });
});

describe('assignLanes', () => {
  it('相距夠遠的標籤共用 lane 0', () => {
    const lanes = assignLanes(
      [
        { label: '成本', text: '成本 50', lxPct: 5 },
        { label: '目標', text: '目標 90', lxPct: 95 },
      ],
      360,
    );
    expect(lanes.get('成本')).toBe(0);
    expect(lanes.get('目標')).toBe(0);
  });

  it('重疊時第二個標籤換到 lane 1', () => {
    const lanes = assignLanes(
      [
        { label: '成本', text: '成本 507.00', lxPct: 48 },
        { label: '目標', text: '目標 512.00', lxPct: 54 },
      ],
      360,
    );
    expect(lanes.get('成本')).toBe(0);
    expect(lanes.get('目標')).toBe(1);
  });

  it('同樣位置但字串變長時會由不換行變成換 lane（字寬敏感）', () => {
    const near = [
      { label: '成本', text: '成本 5', lxPct: 30 },
      { label: '目標', text: '目標 9', lxPct: 46 },
    ];
    const long = [
      { label: '成本', text: '成本 1,234.56', lxPct: 30 },
      { label: '目標', text: '目標 1,234.56 ↓12%', lxPct: 46 },
    ];
    expect(assignLanes(near, 360).get('目標')).toBe(0);
    expect(assignLanes(long, 360).get('目標')).toBe(1);
  });
});

describe('laneTopOffset', () => {
  it('lane 0 永遠不位移', () => {
    expect(laneTopOffset(0, false)).toBe(0);
    expect(laneTopOffset(0, true)).toBe(0);
  });
  it('有換行時 lane 1 需要更大位移', () => {
    expect(laneTopOffset(1, true)).toBeGreaterThan(laneTopOffset(1, false));
  });
});

describe('小螢幕簡化排版（compact）', () => {
  it('窄軌道啟用 compact，寬軌道不啟用', () => {
    expect(isCompactPriceAxis(240)).toBe(true);
    expect(isCompactPriceAxis(PRICE_AXIS_COMPACT_MAX_TRACK)).toBe(true);
    expect(isCompactPriceAxis(PRICE_AXIS_COMPACT_MAX_TRACK + 1)).toBe(false);
    expect(isCompactPriceAxis(560)).toBe(false);
  });

  it('非法寬度退回預設 320（視為 compact 邊界內）', () => {
    expect(isCompactPriceAxis(NaN)).toBe(true);
    expect(isCompactPriceAxis(0)).toBe(true);
  });

  it('compact 軌道較矮且軸線置中', () => {
    const narrow = resolveTrackMetrics(260);
    const wide = resolveTrackMetrics(600);
    expect(narrow.compact).toBe(true);
    expect(narrow.height).toBeLessThan(wide.height);
    expect(narrow.axisY).toBe(Math.round(narrow.height / 2));
    expect(wide.compact).toBe(false);
    expect(wide.height).toBe(82);
    expect(wide.axisY).toBe(52);
  });

  it('toCompactRow 拆出名稱／數值／附註', () => {
    expect(toCompactRow({ label: '成本', text: '成本 507.00' })).toEqual({
      label: '成本', name: '成本', value: '507.00', note: null,
    });
    expect(toCompactRow({ label: '目標', text: '目標 1,280.00 ↓12%' })).toEqual({
      label: '目標', name: '目標', value: '1,280.00', note: '↓12%',
    });
  });

  it('toCompactRow 保留外部 note 並容忍缺前綴', () => {
    expect(toCompactRow({ label: '現價', text: '712.00', note: '延遲' }).value).toBe('712.00');
    expect(toCompactRow({ label: '現價', text: '現價 712.00', note: '延遲' }).note).toBe('延遲');
  });
});
