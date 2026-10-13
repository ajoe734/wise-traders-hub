import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SafeRichHtml } from '@/components/SafeRichHtml';
import { fmtTaipeiDateTime } from '@/lib/articleTime';

/** 老師介紹頁的試讀區：只拿得到伺服器端擷取的試讀段落，完整內文需訂閱。 */
export function TrialArticles({ slug, subscribeHref }: { slug: string; subscribeHref?: string }) {
  const { data = [] } = useQuery({
    queryKey: ['trial-articles', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_trial_articles', { _expert_slug: slug });
      if (error) throw error;
      return data || [];
    },
  });
  if (!data.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">試讀文章</h2>
      {data.map((a: any) => (
        <article key={a.id} className="rounded-2xl border bg-card p-5">
          <div className="text-xs text-muted-foreground">{fmtTaipeiDateTime(a.publish_at)}</div>
          <h3 className="mt-1 font-serif text-xl font-bold text-foreground">{a.title}</h3>
          {a.lede && <p className="mt-2 text-muted-foreground">{a.lede}</p>}
          <div className="relative mt-3">
            <SafeRichHtml html={a.trial_html} className="text-foreground" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
          </div>
          <div className="mt-3 text-sm">
            <span className="text-muted-foreground">完整內容僅限訂閱會員閱讀。</span>
            {subscribeHref && <Link to={subscribeHref} className="ml-2 font-medium text-primary underline">訂閱看全文</Link>}
          </div>
        </article>
      ))}
    </section>
  );
}
