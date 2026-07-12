
-- 1. Persona 表：每位 expert 一列
CREATE TABLE public.expert_ai_personas (
  expert_id uuid PRIMARY KEY REFERENCES public.experts(id) ON DELETE CASCADE,
  system_prompt text,
  tone text[] DEFAULT '{}'::text[],
  forbidden_topics text[] DEFAULT '{}'::text[],
  disclaimer text,
  model text NOT NULL DEFAULT 'openai/gpt-5',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_ai_personas TO authenticated;
GRANT ALL ON public.expert_ai_personas TO service_role;
ALTER TABLE public.expert_ai_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expert_owner_manage_persona" ON public.expert_ai_personas
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  );

-- 2. Few-shot Q&A
CREATE TABLE public.expert_ai_fewshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.expert_ai_fewshots (expert_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_ai_fewshots TO authenticated;
GRANT ALL ON public.expert_ai_fewshots TO service_role;
ALTER TABLE public.expert_ai_fewshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expert_owner_manage_fewshots" ON public.expert_ai_fewshots
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  );

-- 3. 訓練對話 (P2 用；先建欄位)
CREATE TABLE public.expert_ai_training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.expert_signals(id) ON DELETE SET NULL,
  week_start date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','discarded')),
  ai_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_knowledge jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_journal_edits jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.expert_ai_training_sessions (expert_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_ai_training_sessions TO authenticated;
GRANT ALL ON public.expert_ai_training_sessions TO service_role;
ALTER TABLE public.expert_ai_training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expert_owner_manage_training" ON public.expert_ai_training_sessions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  );

-- 4. 擴充 expert_knowledge_chunks：手動條目 + 審核
ALTER TABLE public.expert_knowledge_chunks
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS training_session_id uuid REFERENCES public.expert_ai_training_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS expert_knowledge_chunks_manual_idx
  ON public.expert_knowledge_chunks (expert_id, is_manual, status);

-- 讓老師本人可讀寫自己的知識條目（原本只有 service_role 走）
DROP POLICY IF EXISTS "expert_owner_manage_chunks" ON public.expert_knowledge_chunks;
CREATE POLICY "expert_owner_manage_chunks" ON public.expert_knowledge_chunks
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'company_admin')
  );

-- 5. 更新 RAG 檢索 RPC：只回傳 approved 的條目
CREATE OR REPLACE FUNCTION public.match_expert_knowledge(
  p_expert_id uuid,
  p_query_embedding text,
  p_match_count int DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float,
  is_manual boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.id,
    c.source_type,
    c.source_id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding::vector) AS similarity,
    c.is_manual
  FROM public.expert_knowledge_chunks c
  WHERE c.expert_id = p_expert_id
    AND c.status = 'approved'
  ORDER BY c.embedding <=> p_query_embedding::vector
  LIMIT p_match_count;
$$;

-- 6. updated_at 觸發
CREATE TRIGGER trg_personas_updated_at BEFORE UPDATE ON public.expert_ai_personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_fewshots_updated_at BEFORE UPDATE ON public.expert_ai_fewshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_training_updated_at BEFORE UPDATE ON public.expert_ai_training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_chunks_updated_at BEFORE UPDATE ON public.expert_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
