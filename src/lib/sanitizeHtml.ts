import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'code'];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * 清理 TipTap 編輯器產出的 HTML，
 * 防止把 script/iframe/style 等危險內容寫入資料庫。
 */
export function sanitizeRichHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'style', 'object', 'embed'],
  });
}

/**
 * 把 HTML 轉成純文字，給 AI 助寫 / 摘要 / 預覽用。
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').trim();
}

/**
 * 判斷一段 HTML 是否實質為空（只有空白／空段落）。
 */
export function isHtmlEmpty(html: string): boolean {
  return htmlToPlainText(html).trim().length === 0;
}
