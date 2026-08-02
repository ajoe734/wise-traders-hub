-- 週末沒有任何 BSR worker 在跑，導致 7/28–7/31 的 829 筆 pending 卡到下週一。
select cron.schedule('tw-bsr-worker-weekend', '*/10 * * * 6,0',
  $$SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{"mode": "worker", "batch": 30, "budget_ms": 45000, "max_priority": 3, "ignore_window": true}'::jsonb, 120000);$$);

select cron.schedule('backfill-snapshots-twse-bulk-weekend', '20 7,13 * * 6,0',
  $$SELECT public.cron_edge_call('backfill-snapshots-twse-bulk', '{"refreshCoverage": true}'::jsonb, 120000);$$);