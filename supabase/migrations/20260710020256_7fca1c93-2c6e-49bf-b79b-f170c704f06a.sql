
CREATE TABLE public.expert_ai_index_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expert_id UUID NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  total_chunks INT,
  indexed_chunks INT NOT NULL DEFAULT 0,
  embed_failures INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_index_runs_expert ON public.expert_ai_index_runs(expert_id, started_at DESC);

GRANT SELECT ON public.expert_ai_index_runs TO authenticated;
GRANT ALL ON public.expert_ai_index_runs TO service_role;

ALTER TABLE public.expert_ai_index_runs ENABLE ROW LEVEL SECURITY;

-- 導師本人可看自己的紀錄
CREATE POLICY "expert owner reads own runs"
ON public.expert_ai_index_runs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.experts e
    WHERE e.id = expert_ai_index_runs.expert_id
      AND e.user_id = auth.uid()
  )
);

-- company_admin 可看全部
CREATE POLICY "company admin reads all runs"
ON public.expert_ai_index_runs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'company_admin'));
