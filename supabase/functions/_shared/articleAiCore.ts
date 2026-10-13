/**
 * 教學文章 AI 輔助（第三期）純邏輯：用量上限、圖片分流、一鍵整理守門。
 * Edge Functions（article-ai-image / article-ai-tidy）與前台、Vitest 共用。
 * 原則：含數據／文字的截圖絕不送 AI 重繪；整理只改格式，字詞與順序不可變。
 */

export const ARTICLE_AI_LIMITS = { image: 30, tidy: 20 } as const;
export type ArticleAiKind = keyof typeof ARTICLE_AI_LIMITS;
/** consume_article_ai_quota 回傳 -1 代表今日已滿 */
export const quotaExceeded = (n: number | null | undefined) => n == null || n < 0;

export const RESTYLE_MIN_CONFIDENCE = 0.8;
export interface ImageClassification {
  kind: 'data' | 'illustration';
  has_text_or_numbers: boolean;
  confidence: number;
}
/** 只有「高信心、無文字數字的一般插圖」才允許 AI 重繪；其餘（含分類失敗）一律確定性相框。 */
export function routeImage(c: ImageClassification | null | undefined): 'restyle' | 'frame' {
  if (!c) return 'frame';
  if (c.kind !== 'illustration') return 'frame';
  if (c.has_text_or_numbers) return 'frame';
  if (!(typeof c.confidence === 'number' && c.confidence >= RESTYLE_MIN_CONFIDENCE)) return 'frame';
  return 'restyle';
}

/** 只接受該老師自己上傳到 signal-media/{expertId}/ 的圖 */
export function isOwnArticleUpload(url: string, supabaseUrl: string, expertId: string): boolean {
  if (!url || !expertId || url.includes('..') || url.includes('?')) return false;
  const base = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/signal-media/${expertId}/`;
  return url.startsWith(base) && url.length > base.length && !url.slice(base.length).includes('/');
}

export const LIEFLAT_RESTYLE_PROMPT =
  'Redraw this illustration in a calm editorial "lieflat" style: warm off-white paper background (#F5F3EF), ' +
  'thin even ink outlines, muted low-saturation palette with a single orange accent (#EC662D), flat fills, ' +
  'no shadows, no gradients, no glow. Keep the same subject, composition, layout and aspect ratio. ' +
  'Do not add any text, letters, numbers, logos or watermarks.';

// ───────── 一鍵整理 ─────────
export type TidyIn = { type: 'text'; text: string } | { type: 'img'; ref: number };
export type TidyOutType = 'h2' | 'h3' | 'p' | 'quote' | 'list' | 'img';
export interface TidyOut { type: TidyOutType; text: string; items: string[]; ref: number }

export const TIDY_MAX_CHARS = 12000;
const MARKER = /^\s*(?:[-*•・●▪︎◦]|\d{1,2}[.、)）])\s*/;

/** 比對用：去掉空白與行首清單記號，其餘字元（含標點）必須一字不差 */
export function normalizeWords(s: string): string {
  return (s || '')
    .split(/\r?\n/)
    .map((line) => line.replace(MARKER, ''))
    .join('')
    .replace(/[\s\u3000\u00a0]+/g, '');
}

const outText = (b: TidyOut) => (b.type === 'list' ? (b.items || []).join('\n') : b.text || '');

export function checkTidy(input: TidyIn[], output: TidyOut[]): { ok: true } | { ok: false; reason: string } {
  const inText = normalizeWords(input.map((b) => (b.type === 'text' ? b.text : '')).join('\n'));
  const outJoined = normalizeWords(output.filter((b) => b.type !== 'img').map(outText).join('\n'));
  if (inText !== outJoined) return { ok: false, reason: 'words_changed' };
  const inRefs = input.filter((b) => b.type === 'img').map((b) => (b as { ref: number }).ref);
  const outRefs = output.filter((b) => b.type === 'img').map((b) => b.ref);
  if (inRefs.length !== outRefs.length || inRefs.some((r, i) => r !== outRefs[i])) return { ok: false, reason: 'images_changed' };
  // 圖片相對文字的位置也不可變：每張圖之前的文字必須一致
  const before = (blocks: Array<{ isImg: boolean; t: string }>) => {
    const acc: string[] = []; let buf = '';
    for (const b of blocks) { if (b.isImg) { acc.push(normalizeWords(buf)); } else buf += '\n' + b.t; }
    return acc;
  };
  const a = before(input.map((b) => ({ isImg: b.type === 'img', t: b.type === 'text' ? b.text : '' })));
  const c = before(output.map((b) => ({ isImg: b.type === 'img', t: b.type === 'img' ? '' : outText(b) })));
  if (a.some((x, i) => x !== c[i])) return { ok: false, reason: 'images_moved' };
  return { ok: true };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 把整理結果組回 HTML；圖片用原本的 src/alt 依 ref 放回 */
export function tidyToHtml(output: TidyOut[], images: Array<{ src: string; alt?: string }>): string {
  return output.map((b) => {
    switch (b.type) {
      case 'h2': return `<h2>${esc(b.text)}</h2>`;
      case 'h3': return `<h3>${esc(b.text)}</h3>`;
      case 'quote': return `<blockquote><p>${esc(b.text)}</p></blockquote>`;
      case 'list': return `<ul>${(b.items || []).map((i) => `<li><p>${esc(i.replace(MARKER, ''))}</p></li>`).join('')}</ul>`;
      case 'img': {
        const im = images[b.ref];
        return im ? `<p><img src="${esc(im.src)}" alt="${esc(im.alt || '')}"></p>` : '';
      }
      default: return `<p>${esc(b.text)}</p>`;
    }
  }).join('');
}

export const TIDY_SYSTEM_PROMPT =
  '你是中文部落格排版助理。只能調整「格式」：把內容分成大標(h2)、小標(h3)、段落(p)、重點引言(quote)、條列(list)。' +
  '嚴禁新增、刪除、改寫、翻譯、調換任何字詞或標點；文字順序必須與原文完全相同；可以把原文切段或把一行原文當標題。' +
  '圖片以 {"type":"img","ref":n} 原樣、原位置保留。未用到的欄位填空字串、空陣列或 -1。';
