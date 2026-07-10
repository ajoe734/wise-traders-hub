import { useMemo } from 'react';
import { sanitizeRichHtml, htmlToPlainText } from '@/lib/sanitizeHtml';
import { cn } from '@/lib/utils';

interface SafeRichHtmlProps {
  html: string | null | undefined;
  className?: string;
  /** clamp 行數，超出顯示 ... */
  clamp?: number;
  /** 若為 true，遇到非 HTML（純文字）會把換行轉 <br> */
  preserveLineBreaks?: boolean;
}

const looksLikeHtml = (s: string) => /<\/?(p|br|strong|em|ul|ol|li|h[1-6]|blockquote|a|img|figure)\b/i.test(s);

/**
 * 安全渲染 TipTap 產出的富文字。
 * 若舊資料是純文字（沒有 HTML 標籤），自動以 whitespace-pre-line 顯示。
 */
export function SafeRichHtml({ html, className, clamp, preserveLineBreaks = true }: SafeRichHtmlProps) {
  const { isHtml, content } = useMemo(() => {
    const raw = (html ?? '').trim();
    if (!raw) return { isHtml: false, content: '' };
    if (looksLikeHtml(raw)) {
      return { isHtml: true, content: sanitizeRichHtml(raw) };
    }
    return { isHtml: false, content: raw };
  }, [html]);

  if (!content) return null;

  const clampStyle = clamp
    ? ({ display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties)
    : undefined;

  if (isHtml) {
    return (
      <div
        className={cn(
          'rich-html text-sm text-muted-foreground',
          '[&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-primary [&_a]:underline',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
          '[&_img]:rounded [&_img]:max-w-full [&_img]:h-auto [&_img]:my-2',
          '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1.5',
          '[&_code]:bg-muted [&_code]:px-1 [&_code]:rounded',
          className,
        )}
        style={clampStyle}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  // 純文字 fallback
  return (
    <div
      className={cn('text-sm text-muted-foreground', preserveLineBreaks && 'whitespace-pre-line', className)}
      style={clampStyle}
    >
      {content}
    </div>
  );
}

/**
 * 週記/訊號欄位在「列表/卡片/預覽」情境的截斷長度（詳情頁請直接完整顯示，勿使用）。
 * 集中維護以確保各處 UI 一致。
 */
export const PREVIEW_LIMITS = {
  /** 卡片 / 後台列表：週記標題（reason_summary） */
  cardTitle: 80,
  /** 卡片：週記摘要（reason_detail） */
  cardSummary: 220,
  /** 訊號列表 row：reason_summary */
  listRow: 140,
  /** 儀表板單行預覽 */
  dashboardRow: 100,
  /** risk_notes 極短摘要 */
  riskNoteShort: 60,
  /** learning_points 卡片預覽 */
  learningPointsCard: 500,
  /** learning_points 編輯器預覽 dialog */
  learningPointsPreview: 1000,
} as const;

/** 用來做列表預覽（line-clamp）：把 HTML 拍平成純文字。 */
export function richHtmlPreview(html: string | null | undefined, maxLen = 200): string {
  if (!html) return '';
  const txt = htmlToPlainText(html).replace(/\s+/g, ' ').replace(/^[•·]\s*/g, '').trim();
  return txt.length > maxLen ? txt.slice(0, maxLen) + '…' : txt;
}

/** 純文字轉換：不做截斷，供詳情頁使用。 */
export function richHtmlToPlain(html: string | null | undefined): string {
  if (!html) return '';
  return htmlToPlainText(html).replace(/\s+/g, ' ').replace(/^[•·]\s*/g, '').trim();
}

