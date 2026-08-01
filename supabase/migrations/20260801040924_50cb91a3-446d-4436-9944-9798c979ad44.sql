DO $$ BEGIN
  PERFORM cron.unschedule('pending-journal-publish-reminder-sunday');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('pending-journal-publish-reminder-monday');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'pending-journal-publish-reminder-sunday',
  '30 0 * * 0',
  $$SELECT public.cron_edge_call('pending-journal-publish-reminder', '{"trigger":"sunday"}'::jsonb);$$
);

SELECT cron.schedule(
  'pending-journal-publish-reminder-monday',
  '0 23 * * 0',
  $$SELECT public.cron_edge_call('pending-journal-publish-reminder', '{"trigger":"monday_preopen"}'::jsonb);$$
);