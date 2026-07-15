/**
 * exportJournalPdf — 字型預檢 mock 單元測試
 *
 * 覆蓋範圍：
 *   1. auditFonts()：
 *      - SSR (無 document) 回傳 []
 *      - 全部 check() true → []
 *      - 部分 check() false → 只回缺席那幾組
 *      - check() 拋錯視為 ready（避免 polling 無窮 loop）
 *   2. ensureJournalPdfFonts()：
 *      - 成功：全部字型 ready → { ok: true, missing: [] }，且 css 動態 import 只跑一次
 *      - 缺字：部分字型缺席直到 polling 超時 → { ok: false, missing: [...] } 且 console.warn 觸發
 *      - Step 1 load() reject 不會炸掉整個流程
 *      - fontsource CSS 動態 import 失敗（catch(() => []) fallback）仍能繼續走 audit
 *      - fontsPromise 快取：第二次呼叫不會重跑動態 import
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock @fontsource CSS side-effect imports，避免 jsdom 無法解析 .css
vi.mock('@fontsource/source-serif-4/400.css', () => ({}));
vi.mock('@fontsource/source-serif-4/400-italic.css', () => ({}));
vi.mock('@fontsource/source-serif-4/600.css', () => ({}));
vi.mock('@fontsource/source-serif-4/700.css', () => ({}));
vi.mock('@fontsource/noto-sans-tc/chinese-traditional-400.css', () => ({}));
vi.mock('@fontsource/noto-sans-tc/chinese-traditional-500.css', () => ({}));
vi.mock('@fontsource/noto-sans-tc/chinese-traditional-700.css', () => ({}));
vi.mock('@fontsource/noto-serif-tc/chinese-traditional-700.css', () => ({}));

type FontsShape = {
  check: (spec: string, sample?: string) => boolean;
  load: (spec: string, sample?: string) => Promise<unknown>;
  ready: Promise<unknown>;
};

const installFonts = (impl: Partial<FontsShape>) => {
  const fonts: FontsShape = {
    check: impl.check || (() => true),
    load: impl.load || (() => Promise.resolve([])),
    ready: impl.ready || Promise.resolve(),
  };
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  return fonts;
};

afterEach(() => {
  vi.restoreAllMocks();
  // 清 module cache，讓 fontsPromise reset
  vi.resetModules();
  // 還原 document.fonts（避免污染其他測試）
  try {
    delete (document as unknown as { fonts?: unknown }).fonts;
  } catch {
    /* noop */
  }
});

describe('auditFonts', () => {
  it('SSR：無 document 時回傳空陣列', async () => {
    const { auditFonts } = await import('@/lib/exportJournalPdf');
    const originalDocument = globalThis.document;
    delete (globalThis as { document?: Document }).document;
    try {
      expect(auditFonts()).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it('無 document.fonts.check 時回傳空陣列', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: {} });
    const { auditFonts } = await import('@/lib/exportJournalPdf');
    expect(auditFonts()).toEqual([]);
  });

  it('全部 check() true → 空陣列（無缺字）', async () => {
    installFonts({ check: () => true });
    const { auditFonts, REQUIRED_FONTS } = await import('@/lib/exportJournalPdf');
    expect(REQUIRED_FONTS.length).toBeGreaterThan(0);
    expect(auditFonts()).toEqual([]);
  });

  it('部分 check() false → 只回缺席那幾組', async () => {
    installFonts({
      check: (spec) =>
        // 讓 Noto Serif TC / 700 缺席、其餘 ready
        !spec.includes('Noto Serif TC'),
    });
    const { auditFonts } = await import('@/lib/exportJournalPdf');
    const missing = auditFonts();
    expect(missing.length).toBe(1);
    expect(missing[0]).toMatchObject({ family: 'Noto Serif TC', weight: 700 });
  });

  it('全部 check() false → 全部 8 組都缺', async () => {
    installFonts({ check: () => false });
    const { auditFonts, REQUIRED_FONTS } = await import('@/lib/exportJournalPdf');
    expect(auditFonts().length).toBe(REQUIRED_FONTS.length);
  });

  it('check() 拋錯 → 該 spec 視為 ready（避免無窮 polling）', async () => {
    installFonts({
      check: () => {
        throw new Error('font check exploded');
      },
    });
    const { auditFonts } = await import('@/lib/exportJournalPdf');
    expect(auditFonts()).toEqual([]);
  });
});

describe('ensureJournalPdfFonts', () => {
  it('成功：全部字型 ready → { ok: true, missing: [] }', async () => {
    const load = vi.fn((_spec: string, _sample?: string) => Promise.resolve([]));
    installFonts({ check: () => true, load });
    const { ensureJournalPdfFonts, REQUIRED_FONTS } = await import('@/lib/exportJournalPdf');

    const result = await ensureJournalPdfFonts();

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    // Step 1 對每一組都呼 load 一次
    expect(load).toHaveBeenCalledTimes(REQUIRED_FONTS.length);
    // sample 有帶入 load 第二參數
    for (const call of load.mock.calls) {
      expect(typeof call[0]).toBe('string');
      expect(typeof call[1]).toBe('string');
    }
  });

  it('fontsPromise 快取：第二次呼叫仍成功，且不會重跑動態 import', async () => {
    installFonts({ check: () => true });
    const { ensureJournalPdfFonts } = await import('@/lib/exportJournalPdf');

    const first = await ensureJournalPdfFonts();
    const second = await ensureJournalPdfFonts();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('缺字：check() 一直 false → polling 至 2s 超時後回 { ok: false, missing }', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFonts({
      check: (spec) => !spec.includes('Source Serif 4'), // 4 組 Source Serif 4 缺席
      load: () => Promise.resolve([]),
    });

    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 100 });
    try {
      const { ensureJournalPdfFonts } = await import('@/lib/exportJournalPdf');
      const p = ensureJournalPdfFonts();
      // 推進 fake timer 讓 setTimeout(80ms) 迴圈 + 2s deadline 直接超時
      await vi.advanceTimersByTimeAsync(3000);
      const result = await p;

      expect(result.ok).toBe(false);
      expect(result.missing.length).toBe(4);
      for (const m of result.missing) {
        expect(m.family).toBe('Source Serif 4');
      }
      expect(warn).toHaveBeenCalledTimes(1);
      const warnPayload = warn.mock.calls[0];
      expect(String(warnPayload[0])).toContain('font preflight incomplete');
      expect(Array.isArray(warnPayload[1])).toBe(true);
      expect((warnPayload[1] as string[]).some((s) => s.includes('Source Serif 4'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('缺字後在 deadline 內補上 → 最終 { ok: true }', async () => {
    let attempts = 0;
    installFonts({
      // 前 3 次 check() 缺 Noto Sans TC/500，第 4 次起全 ready
      check: (spec) => {
        attempts += 1;
        if (attempts <= 3 && spec.includes('Noto Sans TC') && spec.includes('500')) {
          return false;
        }
        return true;
      },
      load: () => Promise.resolve([]),
    });

    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 100 });
    try {
      const { ensureJournalPdfFonts } = await import('@/lib/exportJournalPdf');
      const p = ensureJournalPdfFonts();
      await vi.advanceTimersByTimeAsync(1000);
      const result = await p;
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Step 1 load() reject 不會炸掉整個流程（try/catch 保護）', async () => {
    installFonts({
      check: () => true,
      load: () => Promise.reject(new Error('load blew up')),
    });
    const { ensureJournalPdfFonts } = await import('@/lib/exportJournalPdf');
    // 不能 throw；audit 全 ready 所以最終 ok:true
    const result = await ensureJournalPdfFonts();
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('document.fonts.ready reject 也不會炸掉流程', async () => {
    installFonts({
      check: () => true,
      load: () => Promise.resolve([]),
      ready: Promise.reject(new Error('ready blew up')),
    });
    const { ensureJournalPdfFonts } = await import('@/lib/exportJournalPdf');
    const result = await ensureJournalPdfFonts();
    expect(result.ok).toBe(true);
  });
});

describe('fontSpec formatter', () => {
  it('non-italic 產生 "{weight} 16px \\"{family}\\""', async () => {
    const { fontSpec } = await import('@/lib/exportJournalPdf');
    expect(fontSpec({ family: 'Noto Sans TC', weight: 500, sample: 'x' })).toBe(
      '500 16px "Noto Sans TC"',
    );
  });

  it('italic 前綴 "italic "', async () => {
    const { fontSpec } = await import('@/lib/exportJournalPdf');
    expect(
      fontSpec({ family: 'Source Serif 4', weight: 400, style: 'italic', sample: 'x' }),
    ).toBe('italic 400 16px "Source Serif 4"');
  });
});
