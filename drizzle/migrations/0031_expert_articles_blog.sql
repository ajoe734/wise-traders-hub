ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS weekly_article_limit integer;

CREATE TABLE public.expert_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  lede text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  layout text NOT NULL DEFAULT 'longform',
  status text NOT NULL DEFAULT 'draft',
  publish_mode text NOT NULL DEFAULT 'scheduled',
  publish_at timestamptz,
  trial_enabled boolean NOT NULL DEFAULT false,
  trial_html text NOT NULL DEFAULT '',
  cover_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_edited_after_publish_at timestamptz,
  CONSTRAINT expert_articles_layout_chk CHECK (layout IN ('longform','alternating','gallery','cards')),
  CONSTRAINT expert_articles_status_chk CHECK (status IN ('draft','published')),
  CONSTRAINT expert_articles_mode_chk CHECK (publish_mode IN ('immediate','scheduled'))
);
CREATE INDEX expert_articles_expert_pub_idx ON public.expert_articles(expert_id, publish_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_articles TO authenticated;
GRANT ALL ON public.expert_articles TO service_role;
ALTER TABLE public.expert_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "articles owner all" ON public.expert_articles FOR ALL TO authenticated
  USING (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()))
  WITH CHECK (expert_id IN (SELECT id FROM public.experts WHERE user_id = auth.uid()));
CREATE POLICY "articles admin all" ON public.expert_articles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "articles subscriber read" ON public.expert_articles FOR SELECT TO authenticated
  USING (status = 'published' AND publish_at IS NOT NULL AND publish_at <= now()
    AND expert_id IN (SELECT s.expert_id FROM public.has_active_subscription(auth.uid()) s));

CREATE TABLE public.expert_article_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.expert_articles(id) ON DELETE CASCADE,
  title text NOT NULL,
  lede text NOT NULL,
  body_html text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expert_article_revisions TO authenticated;
GRANT ALL ON public.expert_article_revisions TO service_role;
ALTER TABLE public.expert_article_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "article revisions admin read" ON public.expert_article_revisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE OR REPLACE FUNCTION public.expert_articles_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _limit integer;
  _count integer;
  _week date;
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'published' THEN
    IF NEW.publish_at IS NULL THEN
      RAISE EXCEPTION 'ARTICLE_PUBLISH_AT_REQUIRED';
    END IF;
    IF TG_OP = 'INSERT' OR OLD.status <> 'published' OR OLD.publish_at IS DISTINCT FROM NEW.publish_at THEN
      SELECT weekly_article_limit INTO _limit FROM public.experts WHERE id = NEW.expert_id;
      IF _limit IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('expert_articles:' || NEW.expert_id::text));
        _week := date_trunc('week', NEW.publish_at AT TIME ZONE 'Asia/Taipei')::date;
        SELECT count(*) INTO _count FROM public.expert_articles a
          WHERE a.expert_id = NEW.expert_id AND a.status = 'published' AND a.id <> NEW.id
            AND date_trunc('week', a.publish_at AT TIME ZONE 'Asia/Taipei')::date = _week;
        IF _count >= _limit THEN
          RAISE EXCEPTION 'ARTICLE_WEEKLY_LIMIT_REACHED:%', _limit;
        END IF;
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND OLD.publish_at <= now()
       AND (OLD.body_html IS DISTINCT FROM NEW.body_html OR OLD.title IS DISTINCT FROM NEW.title OR OLD.lede IS DISTINCT FROM NEW.lede) THEN
      INSERT INTO public.expert_article_revisions(article_id, title, lede, body_html, edited_by)
        VALUES (OLD.id, OLD.title, OLD.lede, OLD.body_html, auth.uid());
      NEW.last_edited_after_publish_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER expert_articles_guard_trg BEFORE INSERT OR UPDATE ON public.expert_articles
  FOR EACH ROW EXECUTE FUNCTION public.expert_articles_guard();

CREATE OR REPLACE FUNCTION public.list_trial_articles(_expert_slug text)
RETURNS TABLE(id uuid, title text, lede text, trial_html text, cover_url text, layout text, publish_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.title, a.lede, a.trial_html, a.cover_url, a.layout, a.publish_at
  FROM public.expert_articles a JOIN public.experts e ON e.id = a.expert_id
  WHERE e.slug = _expert_slug AND e.status = 'active'
    AND a.status = 'published' AND a.trial_enabled AND a.publish_at <= now()
  ORDER BY a.publish_at DESC LIMIT 20
$$;
GRANT EXECUTE ON FUNCTION public.list_trial_articles(text) TO anon, authenticated;