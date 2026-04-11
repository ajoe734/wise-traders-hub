CREATE OR REPLACE FUNCTION public.notify_subscribers_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS NULL OR OLD.status <> 'published') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    SELECT DISTINCT recipients.user_id,
           '📢 系統公告',
           NEW.title,
           'info',
           NULL
    FROM (
      SELECT ms.user_id
      FROM public.member_subscriptions ms
      WHERE ms.status = 'active'

      UNION

      SELECT e.user_id
      FROM public.experts e
      WHERE e.status IN ('active', 'draft')
    ) AS recipients
    WHERE recipients.user_id IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$function$;