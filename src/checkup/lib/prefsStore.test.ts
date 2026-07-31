import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPrefsStore } from './prefsStore';

const DEFAULTS = { showThesis: true, showCharts: true, mode: 'a' as 'a' | 'b' };

beforeEach(() => {
  localStorage.clear();
});

const make = (over: Partial<Parameters<typeof createPrefsStore>[0]> = {}) =>
  createPrefsStore<typeof DEFAULTS>({ key: 'test.prefs', defaults: DEFAULTS, ...(over as object) });

describe('createPrefsStore', () => {
  it('沒有資料時回 defaults', () => {
    expect(make().load()).toEqual(DEFAULTS);
  });

  it('save 後可讀回，並寫入帶版本的信封', () => {
    const s = make();
    s.save({ showThesis: false });
    expect(s.load().showThesis).toBe(false);
    expect(JSON.parse(localStorage.getItem('test.prefs')!)).toEqual({
      __v: 1,
      data: { ...DEFAULTS, showThesis: false },
    });
  });

  it('save 缺欄位時以 defaults 補齊', () => {
    const s = make();
    expect(s.save({ showCharts: false })).toEqual({ ...DEFAULTS, showCharts: false });
  });

  it('update 以現值為底套用 patch', () => {
    const s = make();
    s.save({ showThesis: false });
    expect(s.update({ showCharts: false })).toEqual({
      showThesis: false,
      showCharts: false,
      mode: 'a',
    });
  });

  it('reset 回到 defaults 並寫回儲存', () => {
    const s = make();
    s.save({ showThesis: false });
    expect(s.reset()).toEqual(DEFAULTS);
    expect(make().load()).toEqual(DEFAULTS);
  });

  it('壞掉的 JSON 回 defaults 而不丟例外', () => {
    localStorage.setItem('test.prefs', '{oops');
    expect(() => make().load()).not.toThrow();
    expect(make().load()).toEqual(DEFAULTS);
  });

  it('非物件內容（陣列 / null / 字串）回 defaults', () => {
    for (const bad of ['[1,2]', 'null', '"str"', '42']) {
      localStorage.setItem('test.prefs', bad);
      expect(make().load()).toEqual(DEFAULTS);
    }
  });

  it('讀得懂沒有 __v 的 legacy 裸物件（v1）', () => {
    localStorage.setItem('test.prefs', JSON.stringify({ showThesis: false }));
    expect(make().load()).toEqual({ ...DEFAULTS, showThesis: false });
  });

  it('版本不符且沒有 migrate 時丟棄舊資料', () => {
    localStorage.setItem('test.prefs', JSON.stringify({ __v: 1, data: { showThesis: false } }));
    const s = createPrefsStore({ key: 'test.prefs', defaults: DEFAULTS, version: 2 });
    expect(s.load()).toEqual(DEFAULTS);
  });

  it('版本不符時走 migrate', () => {
    localStorage.setItem('test.prefs', JSON.stringify({ __v: 1, data: { thesis: 0 } }));
    const s = createPrefsStore<typeof DEFAULTS>({
      key: 'test.prefs',
      defaults: DEFAULTS,
      version: 2,
      migrate: (raw, from) => {
        expect(from).toBe(1);
        return { showThesis: !!(raw as any).thesis };
      },
    });
    expect(s.load()).toEqual({ ...DEFAULTS, showThesis: false });
  });

  it('migrate 丟例外時回 defaults', () => {
    localStorage.setItem('test.prefs', JSON.stringify({ __v: 1, data: {} }));
    const s = createPrefsStore<typeof DEFAULTS>({
      key: 'test.prefs',
      defaults: DEFAULTS,
      version: 3,
      migrate: () => {
        throw new Error('boom');
      },
    });
    expect(s.load()).toEqual(DEFAULTS);
  });

  it('sanitize 會校正非法欄位值', () => {
    localStorage.setItem('test.prefs', JSON.stringify({ mode: 'zzz' }));
    const s = createPrefsStore<typeof DEFAULTS>({
      key: 'test.prefs',
      defaults: DEFAULTS,
      sanitize: (v) => ({ ...v, mode: v.mode === 'b' ? 'b' : 'a' }),
    });
    expect(s.load().mode).toBe('a');
  });

  it('subscribe 會在寫入時收到新值，unsubscribe 後不再收到', () => {
    const s = make();
    const seen: unknown[] = [];
    const off = s.subscribe((v) => seen.push(v.showThesis));
    s.save({ showThesis: false });
    off();
    s.save({ showThesis: true });
    expect(seen).toEqual([false]);
  });

  it('listener 丟例外不影響寫入', () => {
    const s = make();
    s.subscribe(() => {
      throw new Error('bad listener');
    });
    expect(() => s.save({ showThesis: false })).not.toThrow();
    expect(s.load().showThesis).toBe(false);
  });

  it('localStorage.setItem 失敗（quota）時仍保有記憶體值', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const s = make();
    expect(() => s.save({ showThesis: false })).not.toThrow();
    expect(s.load().showThesis).toBe(false);
    spy.mockRestore();
  });

  it('load 回傳的是複本，改動不會污染快取', () => {
    const s = make();
    const a = s.load();
    a.showThesis = false;
    expect(s.load().showThesis).toBe(true);
  });
});
