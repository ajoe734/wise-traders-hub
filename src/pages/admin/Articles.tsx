import { SEO } from '@/components/SEO';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { LAYOUT_LABEL, type ArticleLayout } from '@/lib/articleLayout';
import { fmtTaipeiDateTime } from '@/lib/articleTime';
import { Loader2, PenLine, Plus } from 'lucide-react';
import { toast } from 'sonner';

/** 老師後台：教學文章列表與每週篇數上限設定。 */
const AdminArticles = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-articles', expertSlug],
    enabled: !!expertSlug,
    queryFn: async () => {
      const { data: ex } = await supabase.from('experts').select('id, weekly_article_limit').eq('slug', expertSlug!).maybeSingle();
      if (!ex) return { expert: null, rows: [] as any[] };
      const { data: rows, error } = await supabase
        .from('expert_articles')
        .select('id, title, status, publish_mode, publish_at, layout, trial_enabled, updated_at, notified_revision, notified_at')
        .eq('expert_id', ex.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const ids = (rows || []).map((r) => r.id);
      const { data: logs } = ids.length
        ? await supabase.from('expert_article_push_log').select('article_id, revision, channel, status').in('article_id', ids)
        : { data: [] as any[] };
      const stats: Record<string, { line: number; inapp: number; failed: number; pending: number }> = {};
      for (const r of rows || []) {
        const s = { line: 0, inapp: 0, failed: 0, pending: 0 };
        for (const l of (logs || []).filter((x: any) => x.article_id === r.id && x.revision === r.notified_revision)) {
          if (l.status === 'failed') s.failed++;
          else if (l.status === 'pending') s.pending++;
          else if (l.channel === 'line') s.line++;
          else s.inapp++;
        }
        stats[r.id] = s;
      }
      return { expert: ex, rows: rows || [], stats };
    },
  });

  const [limit, setLimit] = useState('');
  useEffect(() => {
    const l = data?.expert?.weekly_article_limit;
    setLimit(l == null ? '' : String(l));
  }, [data?.expert?.weekly_article_limit]);

  const saveLimit = async () => {
    if (!data?.expert) return;
    const v = limit.trim() === '' ? null : Math.max(1, Math.floor(Number(limit)));
    if (v !== null && !Number.isFinite(v)) return toast.error('請輸入正整數或留空');
    const { error } = await supabase.from('experts').update({ weekly_article_limit: v }).eq('id', data.expert.id);
    if (error) return toast.error(`儲存失敗：${error.message}`);
    toast.success(v == null ? '已設為每週不限篇數' : `已設為每週最多 ${v} 篇`);
    qc.invalidateQueries({ queryKey: ['admin-articles', expertSlug] });
  };

  const retry = async (articleId: string) => {
    const { data: r, error } = await supabase.functions.invoke('article-push', { body: { article_id: articleId, mode: 'retry_failed' } });
    if (error) return toast.error('重試失敗，請稍後再試');
    const failed = ((r as any)?.line_failed ?? 0) + ((r as any)?.inapp_failed ?? 0);
    toast[failed ? 'error' : 'success'](failed ? `仍有 ${failed} 人送不出去` : '已重新送出');
    qc.invalidateQueries({ queryKey: ['admin-articles', expertSlug] });
  };

  const now = Date.now();
  return (
    <AdminLayout>
      <SEO title="教學文章 | legendflow" description="撰寫部落格形式的教學文章。" path={`/admin/${expertSlug || ''}/articles`} noindex />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">教學文章</h1>
            <p className="mt-1 text-sm text-muted-foreground">純教學、沒有個股操作的文章；可貼圖、分大小標題，一週可發多篇。</p>
          </div>
          <Button asChild><Link to={`/admin/${expertSlug}/articles/new`}><Plus className="mr-1 h-4 w-4" />寫教學文章</Link></Button>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div>
              <div className="text-sm font-medium">每週最多發幾篇</div>
              <div className="text-xs text-muted-foreground">留空＝不限；以台北時間週一到週日計算</div>
            </div>
            <Input aria-label="每週篇數上限" className="w-24" inputMode="numeric" value={limit} placeholder="不限" onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} />
            <Button variant="outline" size="sm" onClick={saveLimit}>儲存</Button>
          </CardContent>
        </Card>

        {isLoading && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />載入中...</div>}
        {!isLoading && !data?.rows.length && <div className="text-sm text-muted-foreground">還沒有文章，按「寫教學文章」開始。</div>}
        <div className="space-y-2">
          {(data?.rows || []).map((r: any) => {
            const live = r.status === 'published' && r.publish_at && new Date(r.publish_at).getTime() <= now;
            return (
              <Card key={r.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{r.title || '（未命名）'}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      <Badge variant={live ? 'default' : 'secondary'}>{r.status === 'draft' ? '草稿' : live ? '已公開' : '待公開'}</Badge>
                      <span>{LAYOUT_LABEL[r.layout as ArticleLayout]}</span>
                      {r.publish_at && r.status === 'published' && <span>公開時間 {fmtTaipeiDateTime(r.publish_at)}</span>}
                      {r.trial_enabled && <span>· 開放試讀</span>}
                    </div>
                    {live && (() => {
                      const st = data?.stats?.[r.id];
                      if (r.notified_revision == null) return <div className="mt-1 text-xs text-muted-foreground">通知排程中（幾分鐘內送出）</div>;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>已通知 {(st?.line ?? 0) + (st?.inapp ?? 0)} 人（LINE {st?.line ?? 0}／站內 {st?.inapp ?? 0}）</span>
                          {!!st?.pending && <span>傳送中 {st.pending}</span>}
                          {!!st?.failed && (
                            <button type="button" className="font-medium text-destructive underline" onClick={() => retry(r.id)}>{st.failed} 人失敗，重試</button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/admin/${expertSlug}/articles/edit/${r.id}`}><PenLine className="mr-1 h-4 w-4" />編輯</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminArticles;
