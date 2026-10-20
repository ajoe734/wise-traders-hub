import { richHtmlToPlain } from '@/components/SafeRichHtml';

/**
 * 富文本是否「實質為空」。
 * 空判定必須把媒體算進來：只有 <img>/<iframe>/<video> 而無文字，仍算有內容
 * （導師常只貼一張走勢圖當教學重點）。
 */
export const isRichHtmlEmpty = (raw: string | null | undefined): boolean => {
  if (!raw) return true;
  const hasMedia = /<(img|iframe|video)\b/i.test(raw);
  if (hasMedia) return false;
  return richHtmlToPlain(raw).trim().length === 0;
};

/** 教學重點轉段落（PDF 用）：依 <p>/<br>/<li>/區塊/換行切段，各段各自壓空白。 */
export const learningPointsToParagraphs = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  const marked = raw
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<(p|li|div|h[1-6]|blockquote)\b[^>]*>/gi, '\n');
  return marked
    .split(/\n/)
    .map((seg) => richHtmlToPlain(seg))
    .filter(Boolean);
};
