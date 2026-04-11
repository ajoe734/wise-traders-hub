CREATE OR REPLACE FUNCTION public.notify_subscribers_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (
    TG_OP = 'INSERT' AND NEW.status = 'published'
  ) OR (
    TG_OP = 'UPDATE' AND NEW.status = 'published' AND COALESCE(OLD.status::text, '') <> 'published'
  ) THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    SELECT DISTINCT recipients.user_id,
           '📢 系統公告',
           NEW.title,
           'info',
           NULL
    FROM (
      SELECT p.user_id
      FROM public.profiles p
      WHERE p.user_id IS NOT NULL

      UNION

      SELECT e.user_id
      FROM public.experts e
      WHERE e.user_id IS NOT NULL

      UNION

      SELECT ms.user_id
      FROM public.member_subscriptions ms
      WHERE ms.user_id IS NOT NULL
    ) AS recipients;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_subscribers_on_announcement ON public.announcements;

CREATE TRIGGER trg_notify_subscribers_on_announcement
AFTER INSERT OR UPDATE OF status ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_subscribers_on_announcement();