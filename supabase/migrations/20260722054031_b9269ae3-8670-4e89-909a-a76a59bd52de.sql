-- A1: backfill missing profile rows for existing experts
INSERT INTO public.profiles (user_id, display_name, expert_slug)
SELECT e.user_id,
       COALESCE(u.raw_user_meta_data->>'display_name',
                u.raw_user_meta_data->>'name',
                split_part(u.email, '@', 1),
                e.slug) AS display_name,
       e.slug
FROM public.experts e
JOIN auth.users u ON u.id = e.user_id
LEFT JOIN public.profiles p ON p.user_id = e.user_id
WHERE e.user_id IS NOT NULL
  AND p.id IS NULL;

-- A2: replace trigger function to upsert
CREATE OR REPLACE FUNCTION public.sync_expert_slug_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_display_name text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.slug IS NULL THEN
    RETURN NEW;
  END IF;

  -- Try update first
  UPDATE public.profiles
     SET expert_slug = NEW.slug
   WHERE user_id = NEW.user_id
     AND (expert_slug IS DISTINCT FROM NEW.slug);

  IF NOT FOUND THEN
    -- Insert new profile if missing
    SELECT COALESCE(u.raw_user_meta_data->>'display_name',
                    u.raw_user_meta_data->>'name',
                    split_part(u.email, '@', 1),
                    NEW.slug)
      INTO v_display_name
      FROM auth.users u
     WHERE u.id = NEW.user_id;

    INSERT INTO public.profiles (user_id, display_name, expert_slug)
    VALUES (NEW.user_id, COALESCE(v_display_name, NEW.slug), NEW.slug)
    ON CONFLICT (user_id) DO UPDATE
      SET expert_slug = EXCLUDED.expert_slug;
  END IF;

  RETURN NEW;
END;
$function$;