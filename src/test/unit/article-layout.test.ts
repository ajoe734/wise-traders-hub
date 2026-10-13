import { describe, it, expect } from 'vitest';
import {
  parseArticleBlocks, recommendLayouts, buildTrialHtml, blockOrderFingerprint,
  pendingImageCount, orientationOf, firstImageSrc,
} from '@/lib/articleLayout';
import { nextUnifiedPublishAt } from '@/lib/publishingWindow';
import { articleSaveErrorMessage } from '@/lib/articleTime';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';

const img = (n: number) => `<p><img src="https://x/${n}.png" alt="圖${n}"></p>`;

describe('教學文章：區塊解析', () => {
  it('保留大標／小標／重點句／分隔線，順序不變', () => {
    const b = parseArticleBlocks('<h2>大</h2><p>a</p><h3>小</h3><h4>重點</h4><hr><blockquote>引</blockquote>');
    expect(b.map((x) => x.type)).toEqual(['h2', 'p', 'h3', 'h4', 'hr', 'quote']);
  });
  it('段落中的圖片拆成獨立區塊且順序保持', () => {
    const b = parseArticleBlocks('<p>前<img src="https://x/1.png">後</p>');
    expect(b.map((x) => x.type)).toEqual(['p', 'img', 'p']);
  });
  it('危險內容被移除', () => {
    expect(sanitizeRichHtml('<h2>t</h2><script>alert(1)</script><iframe src="x"></iframe>')).toBe('<h2>t</h2>');
  });
});

describe('教學文章：版型推薦', () => {
  it('永遠回傳四種版型且不重複', () => {
    for (const html of ['', '<p>a</p>', [1, 2, 3, 4, 5].map(img).join('<p>t</p>'), Array.from({ length: 10 }, (_, i) => img(i)).join('')]) {
      const r = recommendLayouts(parseArticleBlocks(html));
      expect(new Set(r.map((x) => x.layout)).size).toBe(4);
    }
  });
  it('0 張圖 → 長文專欄第一', () => {
    expect(recommendLayouts(parseArticleBlocks('<p>a</p><p>b</p>'))[0].layout).toBe('longform');
  });
  it('橫圖 5 張 → 圖集開場第一；直圖為主時不推圖集', () => {
    const blocks = parseArticleBlocks([1, 2, 3, 4, 5].map(img).join(''));
    expect(recommendLayouts(blocks, Array(5).fill('landscape'))[0].layout).toBe('gallery');
    expect(recommendLayouts(blocks, Array(5).fill('portrait'))[0].layout).not.toBe('gallery');
  });
  it('3 個以上小標 → 重點卡片第一', () => {
    expect(recommendLayouts(parseArticleBlocks('<h3>1</h3><p>a</p><h3>2</h3><p>b</p><h3>3</h3><p>c</p>'))[0].layout).toBe('cards');
  });
  it('推薦不改變內容順序', () => {
    const html = `<p>a</p>${img(1)}<h3>s</h3>${img(2)}<p>b</p>`;
    const before = blockOrderFingerprint(parseArticleBlocks(html));
    recommendLayouts(parseArticleBlocks(html));
    expect(blockOrderFingerprint(parseArticleBlocks(html))).toBe(before);
  });
});

describe('教學文章：試讀與上傳檢查', () => {
  it('預設試讀前三行，圖片不算、不外洩後文', () => {
    const t = buildTrialHtml(`<p>一</p>${img(1)}<p>二</p><p>三</p><p>四機密</p>`);
    expect(t).toContain('一'); expect(t).toContain('三');
    expect(t).not.toContain('四機密'); expect(t).not.toContain('<img');
  });
  it('上傳中的 blob 圖片會擋發布', () => {
    expect(pendingImageCount('<img src="blob:abc"><img src="https://x/1.png">')).toBe(1);
  });
  it('圖片方向判斷與封面', () => {
    expect(orientationOf(1600, 1000)).toBe('landscape');
    expect(orientationOf(750, 1334)).toBe('portrait');
    expect(orientationOf(1000, 1000)).toBe('square');
    expect(firstImageSrc(`<p>a</p>${img(7)}`)).toBe('https://x/7.png');
  });
  it('每週上限錯誤轉成老師看得懂的話', () => {
    expect(articleSaveErrorMessage('ARTICLE_WEEKLY_LIMIT_REACHED:3')).toContain('3 篇');
  });
});

describe('教學文章：統一公開時間', () => {
  const tw = (s: string) => new Date(`${s}+08:00`);
  it('台股：週五 19:59 → 當天 20:00；20:00 → 下週五', () => {
    expect(nextUnifiedPublishAt('tw_stock', tw('2026-10-16T19:59:00')).toISOString()).toBe(tw('2026-10-16T20:00:00').toISOString());
    expect(nextUnifiedPublishAt('tw_stock', tw('2026-10-16T20:00:00')).toISOString()).toBe(tw('2026-10-23T20:00:00').toISOString());
  });
  it('台股：週六、週日、週一 07:00 → 該週五 20:00', () => {
    expect(nextUnifiedPublishAt('tw_stock', tw('2026-10-17T10:00:00')).toISOString()).toBe(tw('2026-10-23T20:00:00').toISOString());
    expect(nextUnifiedPublishAt('tw_stock', tw('2026-10-18T10:00:00')).toISOString()).toBe(tw('2026-10-23T20:00:00').toISOString());
    expect(nextUnifiedPublishAt('tw_stock', tw('2026-10-19T07:00:00')).toISOString()).toBe(tw('2026-10-23T20:00:00').toISOString());
  });
  it('美股：週六 07:59 → 當天 08:00；08:00 → 下週六', () => {
    expect(nextUnifiedPublishAt('us_stock', tw('2026-10-17T07:59:00')).toISOString()).toBe(tw('2026-10-17T08:00:00').toISOString());
    expect(nextUnifiedPublishAt('us_stock', tw('2026-10-17T08:00:00')).toISOString()).toBe(tw('2026-10-24T08:00:00').toISOString());
  });
});
