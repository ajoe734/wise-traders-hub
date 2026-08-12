SELECT cron.alter_job(
  45,
  command => $cmd$SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{"mode": "enqueue", "tier1": true, "tier2": false}'::jsonb, 120000);$cmd$
);