
-- Function: when an announcement is published, insert a notification for every active subscriber
CREATE OR REPLACE FUNCTION public.notify_subscribers_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status changes to 'published'
  IF NEW.status = 'published' AND (OLD.status IS NULL OR OLD.status <> 'published') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    SELECT DISTINCT ms.user_id,
           '📢 系統公告',
           NEW.title,
           'info',
           NULL
    FROM public.member_subscriptions ms
    WHERE ms.status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on announcements table
CREATE TRIGGER trg_notify_subscribers_on_announcement
AFTER INSERT OR UPDATE ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_subscribers_on_announcement();
