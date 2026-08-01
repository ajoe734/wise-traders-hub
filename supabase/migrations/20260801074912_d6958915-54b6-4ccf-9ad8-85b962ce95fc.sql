SELECT cron.schedule(
  'tw-inst-cold-start-resume',
  '*/5 * * * *',
  $$SELECT public.cron_edge_call('tw-institutional-daily-sync', '{"mode":"cold_start","days":90,"resume":true,"time_budget_ms":240000}'::jsonb, 280000);$$
);