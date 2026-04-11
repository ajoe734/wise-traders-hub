CREATE OR REPLACE FUNCTION public.cleanup_old_announcements()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete notifications linked to old announcements (older than 7 days)
  DELETE FROM public.notifications
  WHERE type = 'info'
    AND title = '📢 系統公告'
    AND created_at < NOW() - INTERVAL '7 days';

  -- Delete announcements older than 7 days
  DELETE FROM public.announcements
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$function$;