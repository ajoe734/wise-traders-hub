import { describe, it, expect } from 'vitest';
import {
  routeImage, isOwnArticleUpload, checkTidy, tidyToHtml, normalizeWords, quotaExceeded, ARTICLE_AI_LIMITS,
  type TidyOut,
} from '../../../supabase/functions/_shared/articleAiCore';
import { computeTrimBox, computeFrame } from '@/lib/articleImageFrame';

const o = (type: TidyOut['type'], text = '', extra: Partial<TidyOut> = {}): TidyOut => ({ type, text, items: [], ref: -1, ...extra });

describe('圖片分流：數據截圖絕不送 AI 重繪', () => {
  it('高信心無字插圖 → restyle', () => expect(routeImage({ kind: 'illustration', has_text_or_numbers: false, confidence: 0.9 })).toBe('restyle'));
  it('data → frame', () => expect(routeImage({ kind: 'data', has_text_or_numbers: true, confidence: 0.99 })).toBe('frame'));
  it('插圖但含文字數字 → frame', () => expect(routeImage({ kind: 'illustration', has_text_or_numbers: true, confidence: 0.99 })).toBe('frame'));
  it('低信心 0.79 → frame；0.8 → restyle', () => {
    expect(routeImage({ kind: 'illustration', has_text_or_numbers: false, confidence: 0.79 })).toBe('frame');
    expect(routeImage({ kind: 'illustration', has_text_or_numbers: false, confidence: 0.8 })).toBe('restyle');
  });
  it('分類失敗／逾時（null）→ frame', () => expect(routeImage(null)).toBe('frame'));
  it('信心值非數字 → frame', () => expect(routeImage({ kind: 'illustration', has_text_or_numbers: false, confidence: NaN })).toBe('frame'));
});

describe('只能處理自己的圖', () => {
  const U = 'https://x.supabase.co'; const E = 'e1';
  it('自己資料夾 → 可', () => expect(isOwnArticleUpload(`${U}/storage/v1/object/public/signal-media/e1/a.png`, U, E)).toBe(true));
  it('別人資料夾 → 不可', () => expect(isOwnArticleUpload(`${U}/storage/v1/object/public/signal-media/e2/a.png`, U, E)).toBe(false));
  it('路徑跳脫 → 不可', () => expect(isOwnArticleUpload(`${U}/storage/v1/object/public/signal-media/e1/../e2/a.png`, U, E)).toBe(false));
  it('外部網址 → 不可', () => expect(isOwnArticleUpload('https://evil.com/signal-media/e1/a.png', U, E)).toBe(false));
  it('子資料夾 → 不可', () => expect(isOwnArticleUpload(`${U}/storage/v1/object/public/signal-media/e1/x/a.png`, U, E)).toBe(false));
});

describe('每日上限', () => {
  it('上限值', () => expect(ARTICLE_AI_LIMITS).toEqual({ image: 30, tidy: 20 }));
  it('第 30 張回 30 可用；第 31 張回 -1 擋下', () => { expect(quotaExceeded(30)).toBe(false); expect(quotaExceeded(-1)).toBe(true); });
});

describe('一鍵整理守門', () => {
  const input = [{ type: 'text' as const, text: '為什麼停損重要\n停損是保命。\n- 第一點\n- 第二點' }, { type: 'img' as const, ref: 0 }, { type: 'text' as const, text: '結論在此。' }];
  const good = [o('h2', '為什麼停損重要'), o('quote', '停損是保命。'), o('list', '', { items: ['第一點', '第二點'] }), o('img', '', { ref: 0 }), o('p', '結論在此。')];
  it('只改格式 → 通過', () => expect(checkTidy(input, good)).toEqual({ ok: true }));
  it('改一個字 → 擋', () => expect(checkTidy(input, [...good.slice(0, 4), o('p', '結論在這。')])).toEqual({ ok: false, reason: 'words_changed' }));
  it('多加字 → 擋', () => expect(checkTidy(input, [...good, o('p', '新增')])).toMatchObject({ ok: false }));
  it('刪字 → 擋', () => expect(checkTidy(input, good.slice(0, 4))).toMatchObject({ ok: false }));
  it('調換段落順序 → 擋', () => expect(checkTidy(input, [good[1], good[0], ...good.slice(2)])).toMatchObject({ ok: false, reason: 'words_changed' }));
  it('圖片被移位 → 擋', () => expect(checkTidy(input, [good[0], good[3], good[1], good[2], good[4]])).toMatchObject({ ok: false, reason: 'images_moved' }));
  it('圖片被刪 → 擋', () => expect(checkTidy(input, good.filter((b) => b.type !== 'img'))).toMatchObject({ ok: false, reason: 'images_changed' }));
  it('標點改變 → 擋', () => expect(checkTidy([{ type: 'text', text: '好。' }], [o('p', '好！')])).toMatchObject({ ok: false }));
  it('超長文：每字保留即通過', () => {
    const t = '甲'.repeat(11000);
    expect(checkTidy([{ type: 'text', text: t }], [o('p', t.slice(0, 5000)), o('p', t.slice(5000))])).toEqual({ ok: true });
  });
  it('清單項目帶 - 記號也通過，組回時去掉記號', () => {
    const out = [o('list', '', { items: ['- 甲', '- 乙'] })];
    expect(checkTidy([{ type: 'text', text: '- 甲\n- 乙' }], out)).toEqual({ ok: true });
    expect(tidyToHtml(out, [])).toBe('<ul><li><p>甲</p></li><li><p>乙</p></li></ul>');
  });
  it('normalize 去空白與清單記號', () => expect(normalizeWords(' 1. 甲 乙\n• 丙')).toBe('甲乙丙'));
  it('組回 HTML：圖片放回原 src、文字跳脫', () => {
    const html = tidyToHtml([o('h2', '<b>x</b>'), o('img', '', { ref: 0 })], [{ src: 'https://a/b.png', alt: 'k' }]);
    expect(html).toBe('<h2>&lt;b&gt;x&lt;/b&gt;</h2><p><img src="https://a/b.png" alt="k"></p>');
  });
});

describe('確定性相框', () => {
  const px = (w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) => {
    const d: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.push(...fill(x, y));
    return d;
  };
  it('裁掉白邊', () => {
    const d = px(10, 8, (x, y) => (x >= 2 && x <= 6 && y >= 3 && y <= 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(computeTrimBox(d, 10, 8)).toEqual({ x: 2, y: 3, w: 5, h: 3 });
  });
  it('透明 PNG 外框也裁', () => {
    const d = px(6, 6, (x, y) => (x === 3 && y === 2 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
    expect(computeTrimBox(d, 6, 6)).toEqual({ x: 3, y: 2, w: 1, h: 1 });
  });
  it('全圖同色 → 不裁', () => expect(computeTrimBox(px(4, 4, () => [9, 9, 9, 255]), 4, 4)).toEqual({ x: 0, y: 0, w: 4, h: 4 }));
  const cases: Array<[string, number, number, number]> = [['橫圖', 1600, 900, 16 / 9], ['直圖', 900, 1200, 3 / 4], ['方圖', 800, 800, 1], ['超小圖', 40, 30, 4 / 3]];
  for (const [name, w, h, ratio] of cases) {
    it(`${name} 比例 ${ratio.toFixed(2)}、內容 1:1 完整放入`, () => {
      const f = computeFrame(w, h);
      expect(f.ratio).toBeCloseTo(ratio);
      expect(Math.abs(f.width / f.height - ratio)).toBeLessThan(0.02);
      expect(f.dx).toBeGreaterThanOrEqual(16); expect(f.dy).toBeGreaterThanOrEqual(16);
      expect(f.dx + w).toBeLessThanOrEqual(f.width); expect(f.dy + h).toBeLessThanOrEqual(f.height);
    });
  }
});
