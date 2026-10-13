import { describe, it, expect } from 'vitest';
import {
  planArticleAudience, isArticlePushDue, buildArticleFlex, articleTeaser, ARTICLE_PUSH_STALE_MS,
} from '../../../supabase/functions/_shared/articlePushCore';
import { articleDetailUrl, validateNotificationLink } from '../../../supabase/functions/_shared/routes';

const NOW = '2026-10-16T12:00:00.000Z';
const plans = new Set(['p1', 'p2']);
const sub = (user_id: string, o: Partial<{ plan_id: string; canceled_at: string | null; expires_at: string | null }> = {}) =>
  ({ user_id, plan_id: o.plan_id ?? 'p1', canceled_at: o.canceled_at ?? null, expires_at: o.expires_at ?? null });

describe('planArticleAudience — 名單', () => {
  it('有效未取消＋已綁這位老師 → LINE', () => {
    const r = planArticleAudience([sub('a')], [{ user_id: 'a', line_user_id: 'La' }], plans, NOW);
    expect(r.line).toEqual([{ user_id: 'a', line_user_id: 'La' }]);
    expect(r.inapp).toEqual([]);
  });
  it('有效未綁 → 站內', () => {
    const r = planArticleAudience([sub('b')], [], plans, NOW);
    expect(r).toEqual({ line: [], inapp: ['b'] });
  });
  it('已取消未到期（即使已綁）→ 只站內', () => {
    const r = planArticleAudience([sub('c', { canceled_at: '2026-10-01T00:00:00Z', expires_at: '2026-11-01T00:00:00Z' })], [{ user_id: 'c', line_user_id: 'Lc' }], plans, NOW);
    expect(r).toEqual({ line: [], inapp: ['c'] });
  });
  it('已過期 → 都不收', () => {
    const r = planArticleAudience([sub('d', { expires_at: '2026-10-16T11:59:59Z' })], [{ user_id: 'd', line_user_id: 'Ld' }], plans, NOW);
    expect(r).toEqual({ line: [], inapp: [] });
  });
  it('只訂別位老師的方案 → 都不收', () => {
    const r = planArticleAudience([sub('e', { plan_id: 'other' })], [{ user_id: 'e', line_user_id: 'Le' }], plans, NOW);
    expect(r).toEqual({ line: [], inapp: [] });
  });
  it('沒訂閱、只有綁定（綁別的老師或殘留綁定）→ 不收', () => {
    const r = planArticleAudience([], [{ user_id: 'f', line_user_id: 'Lf' }], plans, NOW);
    expect(r).toEqual({ line: [], inapp: [] });
  });
  it('同一人兩個方案（一個取消一個有效）只算一次且走 LINE', () => {
    const r = planArticleAudience(
      [sub('g', { plan_id: 'p1', canceled_at: '2026-10-01T00:00:00Z' }), sub('g', { plan_id: 'p2' })],
      [{ user_id: 'g', line_user_id: 'Lg' }, { user_id: 'g', line_user_id: 'Lg2' }], plans, NOW);
    expect(r.line).toHaveLength(1);
    expect(r.inapp).toEqual([]);
  });
  it('到期日為空視為無到期', () => {
    expect(planArticleAudience([sub('h')], [], plans, NOW).inapp).toEqual(['h']);
  });
});

describe('isArticlePushDue — 時間與去重', () => {
  const at = (iso: string, o: Partial<{ status: string; push_revision: number; notified_revision: number | null }> = {}) => ({
    status: o.status ?? 'published', publish_at: iso, push_revision: o.push_revision ?? 0,
    notified_revision: o.notified_revision === undefined ? null : o.notified_revision,
  });
  // 台股週五 20:00 台北 = 12:00 UTC
  const fri = Date.parse('2026-10-16T12:00:00Z');
  it('草稿不推', () => expect(isArticlePushDue(at('2026-10-16T12:00:00Z', { status: 'draft' }), fri)).toBe(false));
  it('未到時間（前一分鐘）不推', () => expect(isArticlePushDue(at('2026-10-16T12:00:00Z'), fri - 60_000)).toBe(false));
  it('剛好到時間推', () => expect(isArticlePushDue(at('2026-10-16T12:00:00Z'), fri)).toBe(true));
  it('過一分鐘推', () => expect(isArticlePushDue(at('2026-10-16T12:00:00Z'), fri + 60_000)).toBe(true));
  it('美股週六 08:00 台北 = 週六 00:00 UTC 邊界', () => {
    const sat = Date.parse('2026-10-17T00:00:00Z');
    expect(isArticlePushDue(at('2026-10-17T00:00:00Z'), sat - 60_000)).toBe(false);
    expect(isArticlePushDue(at('2026-10-17T00:00:00Z'), sat)).toBe(true);
  });
  it('已通知同版本不再推（修改文章預設不推）', () => expect(isArticlePushDue(at('2026-10-16T12:00:00Z', { notified_revision: 0 }), fri + 1)).toBe(false));
  it('勾重新通知（版本+1）推一次', () => {
    expect(isArticlePushDue(at('2026-10-16T12:00:00Z', { push_revision: 1, notified_revision: 0 }), fri + 1)).toBe(true);
    expect(isArticlePushDue(at('2026-10-16T12:00:00Z', { push_revision: 1, notified_revision: 1 }), fri + 1)).toBe(false);
  });
  it('超過 3 天從未通知的舊文不補推', () => {
    expect(isArticlePushDue(at('2026-10-16T12:00:00Z'), fri + ARTICLE_PUSH_STALE_MS + 1)).toBe(false);
  });
  it('沒有公開時間不推', () => expect(isArticlePushDue({ status: 'published', publish_at: null, push_revision: 0, notified_revision: null }, fri)).toBe(false));
});

describe('LINE 卡片與站內連結', () => {
  const body = '<p>第一段</p><p>第二段</p><p>第三段</p><p>SECRET_FULL_BODY_PART</p>'.padEnd(400, 'x');
  const card = buildArticleFlex({ expertName: '老師', title: '標題', bodyHtml: body + '<p>' + 'y'.repeat(300) + 'TAIL_ONLY_IN_FULL</p>', url: 'https://legendflow.tw/app/article/1' });
  const s = JSON.stringify(card);
  it('卡片不含全文尾段', () => expect(s).not.toContain('TAIL_ONLY_IN_FULL'));
  it('卡片有閱讀全文按鈕', () => expect(s).toContain('閱讀全文'));
  it('非 https 封面不放', () => {
    expect(JSON.stringify(buildArticleFlex({ expertName: 'a', title: 't', coverUrl: 'http://x/y.png', url: 'https://legendflow.tw/' }))).not.toContain('hero');
  });
  it('摘要最多 90 字', () => expect(articleTeaser('<p>' + 'a'.repeat(200) + '</p>').length).toBe(91));
  it('站內連結是合法相對路徑', () => {
    const l = articleDetailUrl('11111111-1111-1111-1111-111111111111');
    expect(l).toBe('/app/article/11111111-1111-1111-1111-111111111111');
    expect(validateNotificationLink(l)).toBeNull();
  });
  it('沒有 id 直接丟錯', () => expect(() => articleDetailUrl('')).toThrow());
});
