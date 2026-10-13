/**
 * 教學文章公開通知的純邏輯（Deno 與 Vitest 共用，唯一資料源）。
 *
 * 名單規則（只看「這位老師」）：
 *   - 有效、未取消、已綁這位老師 LINE → LINE 卡片
 *   - 有效、未取消、沒綁 → 站內通知
 *   - 已取消但未到期 → 站內通知（不推 LINE 卡片）
 *   - 過期、只訂別位老師 → 都不收
 *   - 同一人多方案只算一次；LINE 優先
 */

export interface ArticleSub {
  user_id: string;
  plan_id: string;
  canceled_at: string | null;
  expires_at?: string | null;
}

export interface ArticleBinding {
  user_id: string;
  line_user_id: string;
}

export interface ArticleAudience {
  line: ArticleBinding[];
  inapp: string[];
}

export function planArticleAudience(
  subs: ArticleSub[],
  bindings: ArticleBinding[],
  expertPlanIds: Set<string>,
  nowIso: string = new Date().toISOString(),
): ArticleAudience {
  const relevant = subs.filter(
    (s) => expertPlanIds.has(s.plan_id) && !(s.expires_at && s.expires_at < nowIso),
  );
  const active = new Set(relevant.filter((s) => !s.canceled_at).map((s) => s.user_id));
  const canceledOnly = new Set(
    relevant.filter((s) => s.canceled_at && !active.has(s.user_id)).map((s) => s.user_id),
  );
  const bindingByUser = new Map<string, ArticleBinding>();
  for (const b of bindings) if (!bindingByUser.has(b.user_id)) bindingByUser.set(b.user_id, b);

  const line: ArticleBinding[] = [];
  const inapp: string[] = [];
  for (const uid of active) {
    const b = bindingByUser.get(uid);
    if (b) line.push(b);
    else inapp.push(uid);
  }
  for (const uid of canceledOnly) inapp.push(uid);
  return { line, inapp };
}

/** 超過這個時間才補推的文章不再通知（避免舊文洗版）。 */
export const ARTICLE_PUSH_STALE_MS = 3 * 24 * 60 * 60 * 1000;

export interface ArticleDueInput {
  status: string;
  publish_at: string | null;
  push_revision: number;
  notified_revision: number | null;
}

export function isArticlePushDue(a: ArticleDueInput, nowMs: number = Date.now()): boolean {
  if (a.status !== 'published' || !a.publish_at) return false;
  const t = new Date(a.publish_at).getTime();
  if (!Number.isFinite(t) || t > nowMs) return false;
  if (a.notified_revision != null && a.notified_revision >= a.push_revision) return false;
  // 第一次通知才受「太舊」限制；老師主動重新通知不受限
  if (a.notified_revision == null && nowMs - t > ARTICLE_PUSH_STALE_MS) return false;
  return true;
}

/** HTML → 純文字前 N 行（給卡片摘要用，不含全文）。 */
export function articleTeaser(html: string | null | undefined, maxChars = 90): string {
  const text = String(html ?? '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export interface ArticleCardInput {
  expertName: string;
  title: string;
  lede?: string | null;
  trialHtml?: string | null;
  bodyHtml?: string | null;
  coverUrl?: string | null;
  url: string;
  isRepush?: boolean;
}

/** LINE Flex 卡片：標題＋摘要＋封面＋閱讀全文按鈕。永不放全文。 */
export function buildArticleFlex(i: ArticleCardInput): Record<string, unknown> {
  const summary = (i.lede && i.lede.trim()) || articleTeaser(i.trialHtml || i.bodyHtml);
  const head = i.isRepush ? '🔄 文章更新' : '📖 新教學文章';
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: `${head}｜${i.expertName}`, size: 'xs', color: '#EC662D', weight: 'bold' },
        { type: 'text', text: i.title.slice(0, 100), size: 'lg', weight: 'bold', color: '#292520', wrap: true },
        ...(summary ? [{ type: 'text', text: summary.slice(0, 200), size: 'sm', color: '#555555', wrap: true }] : []),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'button', style: 'primary', color: '#EC662D', action: { type: 'uri', label: '閱讀全文', uri: i.url } }],
    },
  };
  if (i.coverUrl && /^https:\/\//.test(i.coverUrl)) {
    bubble.hero = { type: 'image', url: i.coverUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  }
  return { type: 'flex', altText: `${head}：${i.title}`.slice(0, 400), contents: bubble };
}

export function articleInappText(expertName: string, title: string, isRepush = false) {
  return {
    title: isRepush ? `${expertName} 更新了文章` : `${expertName} 發布了新教學文章`,
    body: title,
  };
}
