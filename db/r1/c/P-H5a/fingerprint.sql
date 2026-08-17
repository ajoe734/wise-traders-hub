-- P-H5a fingerprint（read-only）：六表 rowcount + max timestamp + 內容 hash
-- 大表（tw_bsr_daily / tw_chip_fact）使用「每日分組計數彙總」的 md5 作為內容 hash：
-- 任何 insert/delete 都會改變分組計數；update 由 max timestamp 與逐 symbol 全列 hash 覆蓋。
\pset footer off
SELECT 'tw_bsr_sync_queue' AS tbl, count(*)::text AS rowcount,
       coalesce(max(updated_at)::text,'-') AS max_ts,
       md5(coalesce(string_agg(id::text||status||coalesce(updated_at::text,''), '|' ORDER BY id),'')) AS content_hash
  FROM public.tw_bsr_sync_queue
UNION ALL
SELECT 'tw_bsr_attempt_logs', count(*)::text, coalesce(max(created_at)::text,'-'),
       md5(coalesce(string_agg(id::text, '|' ORDER BY id),''))
  FROM public.tw_bsr_attempt_logs
UNION ALL
SELECT 'tw_chips_rollup', count(*)::text, coalesce(max(updated_at)::text,'-'),
       md5(coalesce(string_agg(id::text||coalesce(updated_at::text,''), '|' ORDER BY id),''))
  FROM public.tw_chips_rollup
UNION ALL
SELECT 'bsr_coverage_daily', count(*)::text, coalesce(max(computed_at)::text,'-'),
       md5(coalesce(string_agg(stock_id||trade_date::text||coalesce(computed_at::text,''), '|' ORDER BY stock_id, trade_date),''))
  FROM public.bsr_coverage_daily
UNION ALL
SELECT 'tw_chip_fact', s.cnt::text, s.mx, s.h FROM (
  SELECT sum(c) AS cnt, coalesce(max(mx)::text,'-') AS mx,
         md5(coalesce(string_agg(trade_date::text||':'||c::text, '|' ORDER BY trade_date),'')) AS h
    FROM (SELECT trade_date, count(*) AS c, max(ingested_at) AS mx FROM public.tw_chip_fact GROUP BY trade_date) d
) s
UNION ALL
SELECT 'tw_bsr_daily', s.cnt::text, s.mx, s.h FROM (
  SELECT sum(c) AS cnt, coalesce(max(mx)::text,'-') AS mx,
         md5(coalesce(string_agg(trade_date::text||':'||c::text, '|' ORDER BY trade_date),'')) AS h
    FROM (SELECT trade_date, count(*) AS c, max(created_at) AS mx FROM public.tw_bsr_daily GROUP BY trade_date) d
) s
UNION ALL
SELECT 'finmind_inflight_requests', count(*)::text, coalesce(max(started_at)::text,'-'),
       md5(coalesce(string_agg(key, '|' ORDER BY key),''))
  FROM public.finmind_inflight_requests
ORDER BY 1;
