CREATE TABLE public.expert_article_ai_usage (
  expert_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','tidy')),
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expert_id, kind, day)
);
GRANT SELECT ON public.expert_article_ai_usage TO authenticated;
GRANT ALL ON public.expert_article_ai_usage TO service_role;
ALTER TABLE public.expert_article_ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner or admin read ai usage" ON public.expert_article_ai_usage
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'company_admin')
  OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.consume_article_ai_quota(_expert_id uuid, _kind text, _limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _day date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  _n integer;
BEGIN
  INSERT INTO public.expert_article_ai_usage(expert_id, kind, day, count)
  VALUES (_expert_id, _kind, _day, 1)
  ON CONFLICT (expert_id, kind, day)
  DO UPDATE SET count = expert_article_ai_usage.count + 1, updated_at = now()
  WHERE expert_article_ai_usage.count < _limit
  RETURNING count INTO _n;
  RETURN COALESCE(_n, -1);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_article_ai_quota(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_article_ai_quota(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_article_ai_quota(_expert_id uuid, _kind text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.expert_article_ai_usage SET count = GREATEST(count - 1, 0), updated_at = now()
  WHERE expert_id = _expert_id AND kind = _kind AND day = (now() AT TIME ZONE 'Asia/Taipei')::date;
$$;
REVOKE ALL ON FUNCTION public.refund_article_ai_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_article_ai_quota(uuid, text) TO service_role;