import { SEO } from '@/components/SEO';
import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { ArticleView } from '@/components/article/ArticleView';
import { supabase } from '@/integrations/supabase/client';
import { parseArticleBlocks, type ArticleLayout } from '@/lib/articleLayout';
import { fmtTaipeiDateTime } from '@/lib/articleTime';
import { Loader2, ArrowLeft } from 'lucide-react';

/** 會員閱讀教學文章；可見性完全由資料庫權限決定（有效訂閱＋已到公開時間）。 */
const ArticleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['app-article', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expert_articles')
        .select('id, title, lede, body_html, layout, publish_at, last_edited_after_publish_at, experts(name, slug)')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const blocks = useMemo(() => parseArticleBlocks(data?.body_html || ''), [data?.body_html]);

  return (
    <UnifiedAppLayout>
      <SEO title={`${data?.title || '教學文章'} | legendflow`} description="導師教學文章" path={`/app/article/${id}`} noindex />
      <div className="p-4">
        <Link to="/app/journals" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />回週記</Link>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !data ? (
          <div className="py-12 text-center text-sm text-muted-foreground">這篇文章尚未公開，或需要有效訂閱才能閱讀。</div>
        ) : (
          <ArticleView
            layout={data.layout as ArticleLayout}
            title={data.title}
            lede={data.lede}
            blocks={blocks}
            meta={
              <>
                {data.experts?.name} · {fmtTaipeiDateTime(data.publish_at)} · 教學文章
                {data.last_edited_after_publish_at && <> · 最後修改 {fmtTaipeiDateTime(data.last_edited_after_publish_at)}</>}
              </>
            }
          />
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default ArticleDetail;
