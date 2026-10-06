CREATE OR REPLACE FUNCTION public.list_position_event_reconstruction_issue_symbols(_expert_id uuid)
RETURNS TABLE(symbol text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.symbol
  FROM public.position_event_reconstruction_issues i
  WHERE i.expert_id = _expert_id
    AND (
      i.expert_id IN (SELECT expert_id FROM public.has_active_subscription(auth.uid()))
      OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = i.expert_id AND e.user_id = auth.uid())
      OR public.has_role(auth.uid(), 'company_admin'::public.app_role)
      OR public.is_tester(auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.list_position_event_reconstruction_issue_symbols(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_position_event_reconstruction_issue_symbols(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_position_event_reconstruction_issue_symbols(uuid) TO service_role;

REVOKE SELECT ON public.position_event_reconstruction_issues FROM authenticated;