-- Add version + uniqueness for knowledge base, plus auto-bump trigger
ALTER TABLE public.checkup_knowledge_items
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Unique key for upsert by (category, item_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkup_knowledge_items_category_item_id_key'
  ) THEN
    ALTER TABLE public.checkup_knowledge_items
      ADD CONSTRAINT checkup_knowledge_items_category_item_id_key
      UNIQUE (category, item_id);
  END IF;
END$$;

-- Auto-bump version + updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.bump_knowledge_item_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_knowledge_item_version ON public.checkup_knowledge_items;
CREATE TRIGGER trg_bump_knowledge_item_version
BEFORE UPDATE ON public.checkup_knowledge_items
FOR EACH ROW
EXECUTE FUNCTION public.bump_knowledge_item_version();

-- Helper: get latest revision timestamp (for cache busting)
CREATE OR REPLACE FUNCTION public.get_knowledge_revision()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(MAX(updated_at), now()) FROM public.checkup_knowledge_items WHERE is_active = true;
$$;