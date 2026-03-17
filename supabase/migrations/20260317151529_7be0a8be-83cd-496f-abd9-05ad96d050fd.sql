-- Create a function to delete expired binding codes
CREATE OR REPLACE FUNCTION public.delete_expired_binding_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.line_binding_codes
  WHERE expires_at < NOW();
END;
$$;

-- Create a cron job to run every minute to clean up expired codes
SELECT cron.schedule(
  'cleanup-expired-binding-codes',
  '* * * * *',
  $$SELECT public.delete_expired_binding_codes()$$
);