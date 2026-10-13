ALTER TABLE public.expert_articles
  ADD COLUMN IF NOT EXISTS push_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notified_revision integer,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN public.expert_articles.push_revision IS '要通知的版本；老師勾「重新通知」時 +1';
COMMENT ON COLUMN public.expert_articles.notified_revision IS '已送出通知的版本；NULL 代表從未通知';

CREATE INDEX IF NOT EXISTS expert_articles_push_due_idx
  ON public.expert_articles (publish_at)
  WHERE status = 'published';

CREATE TABLE public.expert_article_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.expert_articles(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL,
  user_id uuid NOT NULL,
  revision integer NOT NULL,
  channel text NOT NULL CHECK (channel IN ('line', 'inapp')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id, revision)
);

GRANT SELECT ON public.expert_article_push_log TO authenticated;
GRANT ALL ON public.expert_article_push_log TO service_role;
ALTER TABLE public.expert_article_push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "article push log owner read" ON public.expert_article_push_log FOR SELECT TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));
CREATE POLICY "article push log admin read" ON public.expert_article_push_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE INDEX expert_article_push_log_article_idx ON public.expert_article_push_log (article_id, revision);

-- 原子搶佔：只有一條路（排程或立即觸發）能拿到同一版本的通知權
CREATE OR REPLACE FUNCTION public.claim_article_push(_article_id uuid)
RETURNS TABLE (id uuid, expert_id uuid, title text, lede text, trial_html text, body_html text, cover_url text, revision integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.expert_articles a
     SET notified_revision = a.push_revision, notified_at = now()
   WHERE a.id = _article_id
     AND a.status = 'published'
     AND a.publish_at IS NOT NULL
     AND a.publish_at <= now()
     AND (a.notified_revision IS NULL OR a.notified_revision < a.push_revision)
  RETURNING a.id, a.expert_id, a.title, a.lede, a.trial_html, a.body_html, a.cover_url, a.push_revision;
$$;

REVOKE ALL ON FUNCTION public.claim_article_push(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_article_push(uuid) TO service_role;