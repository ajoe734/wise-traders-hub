SELECT cron.alter_job(
  67,
  schedule => '21 7 * * 1-5',
  command  => 'SELECT public.cron_edge_call(''tw-bsr-finmind-sync'', ''{"mode":"probe","force":true}''::jsonb, 120000);'
);