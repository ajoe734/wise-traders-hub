/**
 * 教學文章（部落格）版型：內容區塊解析、四種版型推薦、試讀擷取。
 * 純函式：只改「呈現方式」，絕不改變老師內容的順序。
 */
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';

export type ArticleLayout = 'longform' | 'alternating' | 'gallery' | 'cards';
export const ARTICLE_LAYOUTS: ArticleLayout[] = ['longform', 'alternating', 'gallery', 'cards'];

export const LAYOUT_LABEL: Record<ArticleLayout, string> = {
  longform: '長文專欄',
  alternating: '圖文交錯',
  gallery: '圖集開場',
  cards: '重點卡片',
};

export type BlockType = 'h2' | 'h3' | 'h4' | 'p' | 'quote' | 'list' | 'img' | 'hr';
export interface ArticleBlock {
  type: BlockType;
  /** 已清理過的 HTML（img 為空字串） */
  html: string;
  /** 純文字（img 為 alt） */
  text: string;
  src?: string;
  alt?: string;
}

export type ImageOrientation = 'landscape' | 'portrait' | 'square';

export function orientationOf(w: number, h: number): ImageOrientation {
  if (!w || !h) return 'landscape';
  const r = w / h;
  if (r >= 1.15) return 'landscape';
  if (r <= 0.87) return 'portrait';
  return 'square';
}

/** 解析 TipTap HTML 成依序的區塊；段落裡的圖片拆成獨立圖片區塊（順序保持）。 */
export function parseArticleBlocks(rawHtml: string): ArticleBlock[] {
  const html = sanitizeRichHtml(rawHtml || '');
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  const out: ArticleBlock[] = [];
  const pushImg = (img: HTMLImageElement) => {
    const src = img.getAttribute('src') || '';
    if (!src) return;
    const alt = img.getAttribute('alt') || '';
    out.push({ type: 'img', html: '', text: alt, src, alt });
  };
  root.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const t = (node.textContent || '').trim();
      if (t) out.push({ type: 'p', html: `<p>${escapeHtml(t)}</p>`, text: t });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') return pushImg(node as HTMLImageElement);
    if (tag === 'hr') return void out.push({ type: 'hr', html: '<hr>', text: '' });
    if (tag === 'h1' || tag === 'h2') return void out.push({ type: 'h2', html: node.innerHTML, text: node.textContent?.trim() || '' });
    if (tag === 'h3') return void out.push({ type: 'h3', html: node.innerHTML, text: node.textContent?.trim() || '' });
    if (tag === 'h4' || tag === 'h5' || tag === 'h6') return void out.push({ type: 'h4', html: node.innerHTML, text: node.textContent?.trim() || '' });
    if (tag === 'blockquote') return void out.push({ type: 'quote', html: node.innerHTML, text: node.textContent?.trim() || '' });
    if (tag === 'ul' || tag === 'ol') return void out.push({ type: 'list', html: node.outerHTML, text: node.textContent?.trim() || '' });
    // p / figure / 其他：先處理內含圖片，再處理文字
    const imgs = Array.from(node.querySelectorAll('img'));
    if (imgs.length) {
      // 依 DOM 順序把文字與圖片拆開
      let buf = '';
      const flush = () => {
        const tmp = doc.createElement('div');
        tmp.innerHTML = buf;
        const t = tmp.textContent?.trim() || '';
        if (t) out.push({ type: 'p', html: `<p>${buf}</p>`, text: t });
        buf = '';
      };
      node.childNodes.forEach((c) => {
        if (c instanceof HTMLImageElement) { flush(); pushImg(c); }
        else if (c instanceof HTMLElement && c.querySelector('img')) {
          flush();
          c.querySelectorAll('img').forEach((i) => pushImg(i as HTMLImageElement));
        } else buf += c instanceof HTMLElement ? c.outerHTML : escapeHtml(c.textContent || '');
      });
      flush();
      return;
    }
    const t = node.textContent?.trim() || '';
    if (t) out.push({ type: 'p', html: tag === 'p' ? node.innerHTML : node.outerHTML, text: t });
  });
  return out;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface LayoutRecommendation {
  layout: ArticleLayout;
  score: number;
  reason: string;
}

/**
 * 依圖片／文字數量與圖片方向，回傳四種版型由最適合到最不適合的排序（永遠 4 個）。
 * orientations：依圖片出現順序的方向（未知可省略，視為橫圖）。
 */
export function recommendLayouts(
  blocks: ArticleBlock[],
  orientations: ImageOrientation[] = [],
): LayoutRecommendation[] {
  const imgs = blocks.filter((b) => b.type === 'img').length;
  const paras = blocks.filter((b) => b.type === 'p' || b.type === 'quote' || b.type === 'list').length;
  const subheads = blocks.filter((b) => b.type === 'h2' || b.type === 'h3').length;
  const portrait = orientations.filter((o) => o === 'portrait').length;
  const portraitHeavy = imgs > 0 && portrait / imgs >= 0.5;

  const recs: LayoutRecommendation[] = [
    {
      layout: 'longform',
      score: imgs <= 1 ? 90 : Math.max(20, 70 - imgs * 8),
      reason: imgs <= 1 ? '以文字為主，單欄閱讀最舒服' : '文字段落完整，可當備選',
    },
    {
      layout: 'alternating',
      score: imgs >= 2 && paras >= imgs * 0.6 ? 85 - Math.abs(paras - imgs) * 3 : 30,
      reason: imgs >= 2 ? '圖片與段落數量接近，左右交錯不疲勞' : '圖片較少，交錯效果有限',
    },
    {
      layout: 'gallery',
      score: imgs >= 4 ? (portraitHeavy ? 60 : 92) : 25,
      reason: imgs >= 4
        ? (portraitHeavy ? '圖多但多為手機直圖，改兩張並排呈現' : '圖片多，首圖開場＋相簿最清楚')
        : '圖片少於 4 張，不適合圖集',
    },
    {
      layout: 'cards',
      score: subheads >= 3 ? 88 : subheads === 2 ? 55 : 20,
      reason: subheads >= 3 ? `有 ${subheads} 個小標，切成重點卡片好掃讀` : '小標太少，卡片會太空',
    },
  ];
  const order: Record<ArticleLayout, number> = { longform: 0, alternating: 1, gallery: 2, cards: 3 };
  return recs.sort((a, b) => b.score - a.score || order[a.layout] - order[b.layout]);
}

/** 試讀 HTML：取前 N 行文字（標題與段落各算一行，圖片不算），預設 3 行。 */
export function buildTrialHtml(rawHtml: string, lines = 3): string {
  const blocks = parseArticleBlocks(rawHtml);
  const parts: string[] = [];
  let n = 0;
  for (const b of blocks) {
    if (n >= lines) break;
    if (b.type === 'img' || b.type === 'hr') continue;
    if (b.type === 'h2' || b.type === 'h3' || b.type === 'h4') parts.push(`<${b.type}>${b.html}</${b.type}>`);
    else if (b.type === 'quote') parts.push(`<blockquote>${b.html}</blockquote>`);
    else if (b.type === 'list') parts.push(b.html);
    else parts.push(`<p>${b.html}</p>`);
    n++;
  }
  return sanitizeRichHtml(parts.join(''));
}

/** 第一張圖當封面。 */
export function firstImageSrc(rawHtml: string): string | null {
  return parseArticleBlocks(rawHtml).find((b) => b.type === 'img')?.src ?? null;
}

/** 上傳中（blob:/data:）的圖片數；>0 時禁止發布。 */
export function pendingImageCount(rawHtml: string): number {
  return (rawHtml.match(/<img[^>]+src=["'](blob:|data:)/gi) || []).length;
}

/** 文章區塊順序指紋：用來驗證「換版型不改順序」。 */
export function blockOrderFingerprint(blocks: ArticleBlock[]): string {
  return blocks.map((b) => `${b.type}:${b.src ?? b.text}`).join('|');
}
