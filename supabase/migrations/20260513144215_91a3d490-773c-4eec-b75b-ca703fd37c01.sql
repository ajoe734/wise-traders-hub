-- Phase 3：啟用 pg_trgm 用於相似度比對
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Phase 1：sync 功能下線後移除設定表
DROP TABLE IF EXISTS public.knowledge_sync_settings CASCADE;
