// 回歸測試：匯出偏好白名單必須含 pdf。
// 事故背景（C5 收斂）：drawerPrefs 的 FORMATS 只有 ['png','jpeg']，
// UI 卻提供 PNG/PDF 兩顆按鈕 → 選 PDF 會被 sanitize 回 png，偏好無法持久化。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  holdingExportPrefs,
  holdingPanelPrefs,
  DEFAULT_EXPORT_PREFS,
  type HoldingExportPrefs,
} from './drawerPrefs';

const KEY = 'holdingPanel.export.v1';

function stored(): any {
  const raw = JSON.parse(window.localStorage.getItem(KEY) || '{}');
  return raw && typeof raw === 'object' && raw.data ? raw.data : raw;
}

describe('holdingExportPrefs — 格式白名單', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // store 有記憶體快取，清 storage 後要 reset 才會回到乾淨狀態
    holdingExportPrefs.reset();
    holdingPanelPrefs.reset();
  });

  it.each(['png', 'jpeg', 'pdf'] as const)('%s 是合法格式，save 後原值讀回', (format) => {
    holdingExportPrefs.save({ ...DEFAULT_EXPORT_PREFS, format });
    expect(holdingExportPrefs.load().format).toBe(format);
    expect(stored().format).toBe(format);
  });

  it('選 pdf 不會被 sanitize 成 png（本次回歸點）', () => {
    holdingExportPrefs.save({ format: 'pdf', ratio: 'wide', resolution: 'high' });
    expect(holdingExportPrefs.load()).toMatchObject({
      format: 'pdf',
      ratio: 'wide',
      resolution: 'high',
    });
  });

  it('未知格式仍降級成預設 png', () => {
    holdingExportPrefs.save({ format: 'webp', ratio: 'square', resolution: 'high' } as unknown as HoldingExportPrefs);
    expect(holdingExportPrefs.load().format).toBe('png');
  });

  it('壞掉的 JSON 回預設值，不炸抽屜', () => {
    window.localStorage.setItem(KEY, '{oops');
    expect(holdingExportPrefs.load()).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it('面板偏好與匯出偏好使用不同 key，互不污染', () => {
    holdingExportPrefs.save({ format: 'pdf', ratio: 'wide', resolution: 'std' });
    holdingPanelPrefs.save({ ...holdingPanelPrefs.load(), showSandbox: true });
    expect(holdingExportPrefs.load().format).toBe('pdf');
    expect(holdingPanelPrefs.load().showSandbox).toBe(true);
  });
});

describe('UI 選項與白名單契約', () => {
  it('HoldingsDetailPanel 的格式按鈕值必須全部落在白名單內', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync('src/checkup/components/freecheckup/HoldingsDetailPanel.tsx', 'utf8'),
    );
    const seg = src.split("data-testid=\"export-seg-format\"")[1]?.slice(0, 400) ?? '';
    const values = [...seg.matchAll(/value:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      holdingExportPrefs.save({ ...DEFAULT_EXPORT_PREFS, format: v as HoldingExportPrefs['format'] });
      expect(holdingExportPrefs.load().format, `UI 提供 ${v} 但白名單不接受`).toBe(v);
    }
  });
});

describe('holdingExportPrefs — 佔比排名開關', () => {
  beforeEach(() => {
    window.localStorage.clear();
    holdingExportPrefs.reset();
  });

  it('預設包含佔比排名', () => {
    expect(holdingExportPrefs.load().includeWeightRank).toBe(true);
  });

  it('舊資料缺欄位時 fallback 為 true（維持既有行為）', () => {
    const p = holdingExportPrefs.save(
      { format: 'pdf', ratio: 'wide', resolution: 'print' } as unknown as HoldingExportPrefs,
    );
    expect(p.includeWeightRank).toBe(true);
    expect(p.format).toBe('pdf');
  });

  it('非布林值會被正規化', () => {
    const saved = holdingExportPrefs.save({
      ...DEFAULT_EXPORT_PREFS,
      includeWeightRank: 0 as unknown as boolean,
    });
    expect(saved.includeWeightRank).toBe(false);
    expect(stored().includeWeightRank).toBe(false);
  });

  it('關閉後可持久化', () => {
    holdingExportPrefs.save({ ...DEFAULT_EXPORT_PREFS, includeWeightRank: false });
    expect(holdingExportPrefs.load().includeWeightRank).toBe(false);
  });
});

describe('holdingPanelPrefs — 佔比排名摺疊狀態', () => {
  beforeEach(() => {
    window.localStorage.clear();
    holdingPanelPrefs.reset();
  });

  it('預設收合', () => {
    expect(holdingPanelPrefs.load().weightRankOpen).toBe(false);
  });

  it('展開狀態可持久化', () => {
    holdingPanelPrefs.save({ ...holdingPanelPrefs.load(), weightRankOpen: true });
    expect(holdingPanelPrefs.load().weightRankOpen).toBe(true);
  });
});


describe('chipsPrefs — 關鍵分點視窗', () => {
  beforeEach(() => localStorage.clear());

  it('預設為 5 日', () => {
    expect(chipsPrefs.get().bsrWindow).toBe('d5');
  });

  it('可存取 1／5／10 日並在重讀後保留', () => {
    for (const w of ['d1', 'd5', 'd10'] as const) {
      chipsPrefs.set({ bsrWindow: w });
      expect(chipsPrefs.get().bsrWindow).toBe(w);
    }
  });

  it('非法值 sanitize 回 5 日（不會讓抽屜讀到不存在的視窗）', () => {
    localStorage.setItem('holdingPanel.chips.v1', JSON.stringify({ v: 1, data: { bsrWindow: 'd20' } }));
    expect(chipsPrefs.get().bsrWindow).toBe('d5');
    localStorage.setItem('holdingPanel.chips.v1', 'not-json');
    expect(chipsPrefs.get().bsrWindow).toBe('d5');
  });
});
