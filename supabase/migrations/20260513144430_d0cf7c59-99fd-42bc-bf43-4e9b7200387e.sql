CREATE OR REPLACE FUNCTION public.check_knowledge_title_similarity(
  _category text,
  _title text,
  _threshold numeric DEFAULT 0.85
)
RETURNS TABLE (id uuid, item_id text, title text, sim real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    k.id,
    k.item_id,
    k.title,
    similarity(k.title, _title) AS sim
  FROM public.checkup_knowledge_items k
  WHERE k.category = _category
    AND k.lifecycle_status = 'active'
    AND k.is_active = true
    AND similarity(k.title, _title) >= _threshold
  ORDER BY similarity(k.title, _title) DESC
  LIMIT 5;
$$;

REVOKE EXECUTE ON FUNCTION public.check_knowledge_title_similarity(text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_knowledge_title_similarity(text, text, numeric) TO service_role, authenticated;
