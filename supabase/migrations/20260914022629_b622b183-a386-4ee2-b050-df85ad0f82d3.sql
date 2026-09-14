REVOKE ALL ON FUNCTION public.validate_journal_reminder_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_journal_reminder_settings() TO service_role;