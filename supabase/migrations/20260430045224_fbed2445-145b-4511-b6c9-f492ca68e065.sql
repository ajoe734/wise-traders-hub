DROP VIEW IF EXISTS public.checkup_knowledge_usage_stats;

CREATE VIEW public.checkup_knowledge_usage_stats
WITH (security_invoker = true) AS
SELECT
  ki.id AS knowledge_item_id,
  COUNT(kh.id) AS hit_count,
  COUNT(kh.id) FILTER (WHERE kh.created_at > now() - interval '7 days') AS hit_count_7d,
  MAX(kh.created_at) AS last_hit_at
FROM public.checkup_knowledge_items ki
LEFT JOIN public.checkup_knowledge_hits kh ON kh.knowledge_item_id = ki.id
GROUP BY ki.id;

GRANT SELECT ON public.checkup_knowledge_usage_stats TO authenticated;