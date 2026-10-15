import { describe, it, expect } from 'vitest';
import { extractCnyesArticleText, keepKeyParagraphs, fullTextPriority } from '../../../supabase/functions/_shared/articleFullText';

const page = `<html><article>skeleton</article><main id="article-container" class="x"><section><p>台達電第三季營收創高。</p></section><section><p>美系外資給予 2027 年 EPS 45 元、目標本益比 40 倍，目標價 1,800&nbsp;元。</p></section></main><footer>x</footer></html>`;

describe('articleFullText', () => {
  it('取出 article-container 內文且保留逐字數字', () => {
    const t = extractCnyesArticleText(page);
    expect(t).toContain('目標本益比 40 倍');
    expect(t).toContain('目標價 1,800 元');
    expect(t).not.toContain('skeleton');
    expect(t).not.toContain('footer');
  });
  it('找不到內文容器回空字串', () => {
    expect(extractCnyesArticleText('<html><p>無內文</p></html>')).toBe('');
  });
  it('超長時只保留含估值字眼的段落、順序不變', () => {
    const text = ['無關段落'.repeat(50), '外資給予本益比 30 倍', '其他'.repeat(50), '預估 EPS 20 元'].join('\n');
    expect(keepKeyParagraphs(text, 100)).toBe('外資給予本益比 30 倍\n預估 EPS 20 元');
  });
  it('未超長原文不變', () => {
    expect(keepKeyParagraphs('短文', 100)).toBe('短文');
  });
  it('本益比文章優先序最高', () => {
    expect(fullTextPriority('奇鋐 本益比', '')).toBeGreaterThan(fullTextPriority('奇鋐 目標價', ''));
    expect(fullTextPriority('奇鋐 新廠', '')).toBe(0);
  });
});
