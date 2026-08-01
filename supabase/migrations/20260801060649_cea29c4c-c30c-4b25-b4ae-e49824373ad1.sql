SELECT public.cron_edge_call('tw-bsr-window-converge', '{"max_stocks": 40}'::jsonb);
SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{"mode":"worker","limit":20}'::jsonb);