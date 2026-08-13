-- Build2 P4 / M1: job 67 由空 payload（實際 fallback 成 mode=worker）改為明確的 market-batch capability probe。
-- 舊：'0 9 * * *'  + '{}'                → 每天 UTC 09:00 跑 worker（與 probe 無關）
-- 新：'21 7 * * 1-5' + '{"mode":"probe"}' → 交易日 UTC 07:21（Taipei 15:21）收盤後探測一次
-- probe 內建 24h idempotency（probed_at），重複觸發不會重打 FinMind。
SELECT cron.alter_job(
  job_id  => 67,
  schedule => '21 7 * * 1-5',
  command  => $cmd$SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{"mode": "probe"}'::jsonb, 120000);$cmd$
);