-- Backfill missing expert_slug on profiles for all experts
UPDATE public.profiles p
SET expert_slug = e.slug
FROM public.experts e
WHERE e.user_id = p.user_id
  AND e.slug IS NOT NULL
  AND (p.expert_slug IS NULL OR p.expert_slug <> e.slug);

-- Auto-sync trigger going forward
CREATE OR REPLACE FUNCTION public.sync_expert_slug_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.slug IS NOT NULL THEN
    UPDATE public.profiles
       SET expert_slug = NEW.slug
     WHERE user_id = NEW.user_id
       AND (expert_slug IS DISTINCT FROM NEW.slug);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_expert_slug_to_profile ON public.experts;
CREATE TRIGGER trg_sync_expert_slug_to_profile
AFTER INSERT OR UPDATE OF slug, user_id ON public.experts
FOR EACH ROW
EXECUTE FUNCTION public.sync_expert_slug_to_profile();