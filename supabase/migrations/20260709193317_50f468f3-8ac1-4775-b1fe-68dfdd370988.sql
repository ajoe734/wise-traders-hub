
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. expert_knowledge_chunks: RAG 檢索來源
CREATE TABLE public.expert_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('bio','signal','trade_summary')),
  source_id uuid,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expert_knowledge_chunks_expert ON public.expert_knowledge_chunks(expert_id);
CREATE INDEX idx_expert_knowledge_chunks_embedding
  ON public.expert_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

GRANT ALL ON public.expert_knowledge_chunks TO service_role;
-- 一般用戶不可讀，僅 service_role 存取
ALTER TABLE public.expert_knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages chunks" ON public.expert_knowledge_chunks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. expert_ai_conversations
CREATE TABLE public.expert_ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  title text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expert_id)
);
CREATE INDEX idx_expert_ai_conversations_user ON public.expert_ai_conversations(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_ai_conversations TO authenticated;
GRANT ALL ON public.expert_ai_conversations TO service_role;
ALTER TABLE public.expert_ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own conversations" ON public.expert_ai_conversations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. expert_ai_messages
CREATE TABLE public.expert_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.expert_ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expert_ai_messages_conv ON public.expert_ai_messages(conversation_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_ai_messages TO authenticated;
GRANT ALL ON public.expert_ai_messages TO service_role;
ALTER TABLE public.expert_ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read messages of own convs" ON public.expert_ai_messages
  FOR SELECT TO authenticated
  USING (conversation_id IN (
    SELECT id FROM public.expert_ai_conversations WHERE user_id = auth.uid()
  ));
CREATE POLICY "users insert messages to own convs" ON public.expert_ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (conversation_id IN (
    SELECT id FROM public.expert_ai_conversations WHERE user_id = auth.uid()
  ));
CREATE POLICY "users delete messages of own convs" ON public.expert_ai_messages
  FOR DELETE TO authenticated
  USING (conversation_id IN (
    SELECT id FROM public.expert_ai_conversations WHERE user_id = auth.uid()
  ));

-- 4. RPC: 相似度檢索
CREATE OR REPLACE FUNCTION public.match_expert_knowledge(
  p_expert_id uuid,
  p_query_embedding vector(1536),
  p_match_count int DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.source_type,
    c.source_id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.expert_knowledge_chunks c
  WHERE c.expert_id = p_expert_id
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_expert_knowledge TO service_role;
