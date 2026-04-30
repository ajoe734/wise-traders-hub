-- 候選池：同類別下，pending 狀態的 item_id 須唯一（NULL 不擋）
CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_candidates_pending_item_id
  ON public.checkup_knowledge_candidates (category, item_id)
  WHERE item_id IS NOT NULL AND status = 'pending';