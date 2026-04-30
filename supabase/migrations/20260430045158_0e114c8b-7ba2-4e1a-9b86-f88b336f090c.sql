-- Knowledge hits: 每次 AI 分析命中的知識條目
CREATE TABLE public.checkup_knowledge_hits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  knowledge_item_id uuid NOT NULL REFERENCES public.checkup_knowledge_items(id) ON DELETE CASCADE,
  user_id uuid,
  stock_code text,
  context text,
  confidence numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_hits_item ON public.checkup_knowledge_hits(knowledge_item_id);
CREATE INDEX idx_knowledge_hits_created ON public.checkup_knowledge_hits(created_at DESC);

ALTER TABLE public.checkup_knowledge_hits ENABLE ROW LEVEL SECURITY;

-- 任何登入使用者都可寫入自己的命中（user_id = auth.uid() 或 NULL）
CREATE POLICY "Users insert own hits"
ON public.checkup_knowledge_hits
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- 管理員看全部
CREATE POLICY "Admins view all hits"
ON public.checkup_knowledge_hits
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role));

-- 用戶可看自己的
CREATE POLICY "Users view own hits"
ON public.checkup_knowledge_hits
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- 管理員可清理
CREATE POLICY "Admins delete hits"
ON public.checkup_knowledge_hits
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role));

-- 聚合視圖：每條知識條目的命中統計
CREATE OR REPLACE VIEW public.checkup_knowledge_usage_stats AS
SELECT
  ki.id AS knowledge_item_id,
  COUNT(kh.id) AS hit_count,
  COUNT(kh.id) FILTER (WHERE kh.created_at > now() - interval '7 days') AS hit_count_7d,
  MAX(kh.created_at) AS last_hit_at
FROM public.checkup_knowledge_items ki
LEFT JOIN public.checkup_knowledge_hits kh ON kh.knowledge_item_id = ki.id
GROUP BY ki.id;

GRANT SELECT ON public.checkup_knowledge_usage_stats TO authenticated;