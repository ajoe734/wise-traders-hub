CREATE OR REPLACE FUNCTION public.get_plan_expert_status(p_plan_id uuid)
RETURNS TABLE (expert_id uuid, expert_name text, expert_slug text, expert_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.name, e.slug, e.status
  FROM public.expert_plans p
  JOIN public.experts e ON e.id = p.expert_id
  WHERE p.id = p_plan_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_plan_expert_status(uuid) TO anon, authenticated;