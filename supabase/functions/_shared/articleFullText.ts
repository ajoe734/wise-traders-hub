// 純函式：從新聞文章頁 HTML 取出內文全文，並保留含估值關鍵字的段落。
// 前瞻本益比通常只出現在全文（券商評等段落），標題／摘要拿不到；與 Vitest 共用。

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

export function htmlToPlain(html: string): string {
  return String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|li|h\d|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, (m) => ENTITIES[m])
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** 鉅亨網文章頁：內文在 <main id="article-container">…</main>。找不到回空字串（不猜）。 */
export function extractCnyesArticleText(html: string): string {
  const m = String(html || '').match(/<main[^>]*id="article-container"[^>]*>([\s\S]*?)<\/main>/i);
  return m ? htmlToPlain(m[1]) : '';
}

export const VALUATION_KEYWORDS = ['本益比', '倍', '目標價', 'EPS', '每股盈餘', '每股純益', '評等', '法說', '預估', '獲利'];

/**
 * 全文過長時，只保留含關鍵字的段落（原文逐字、順序不變），確保引句仍可在原文中逐字找到。
 * 不足 maxChars 直接回傳原文。
 */
export function keepKeyParagraphs(text: string, maxChars = 6000, keywords = VALUATION_KEYWORDS): string {
  const t = String(text || '');
  if (t.length <= maxChars) return t;
  const paras = t.split('\n').filter((p) => p.trim());
  const out: string[] = []; let len = 0;
  for (const p of paras) {
    if (!keywords.some((k) => p.includes(k))) continue;
    if (len + p.length + 1 > maxChars) break;
    out.push(p); len += p.length + 1;
  }
  return out.join('\n');
}

/** 標題或摘要含估值字眼的文章優先抓全文。 */
export function fullTextPriority(title: string, summary: string): number {
  const s = `${title} ${summary}`;
  return (s.includes('本益比') ? 4 : 0) + (s.includes('目標價') ? 3 : 0) + (/EPS|每股/.test(s) ? 2 : 0) + (s.includes('法說') ? 1 : 0);
}
