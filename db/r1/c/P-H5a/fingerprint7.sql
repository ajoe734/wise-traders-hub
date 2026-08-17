-- Stage A 驗收：七表 scoped deterministic fingerprint（rowcount + max timestamp + 內容 md5）
-- 註：bsr_coverage_daily / tw_chip_fact 無 created_at/updated_at 欄位，改以 trade_date 作時間軸。
select 'tw_bsr_daily' t, count(*) n, max(created_at)::text mx,
       md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) h
  from (select * from tw_bsr_daily where trade_date >= current_date - 10) x
union all
select 'tw_chips_rollup', count(*), max(updated_at)::text,
       md5(coalesce(string_agg(md5(y::text), '' order by md5(y::text)), ''))
  from (select * from tw_chips_rollup where updated_at >= now() - interval '30 days') y
union all
select 'tw_bsr_sync_queue', count(*), max(greatest(created_at, coalesce(updated_at, created_at)))::text,
       md5(coalesce(string_agg(md5(z::text), '' order by md5(z::text)), ''))
  from (select * from tw_bsr_sync_queue) z
union all
select 'bsr_coverage_daily', count(*), max(trade_date)::text,
       md5(coalesce(string_agg(md5(a::text), '' order by md5(a::text)), ''))
  from (select * from bsr_coverage_daily where trade_date >= current_date - 10) a
union all
select 'tw_bsr_attempt_logs', count(*), max(created_at)::text,
       md5(coalesce(string_agg(md5(b::text), '' order by md5(b::text)), ''))
  from (select * from tw_bsr_attempt_logs where created_at >= now() - interval '3 days') b
union all
select 'tw_bsr_fetch_failures', count(*), max(greatest(created_at, coalesce(updated_at, created_at)))::text,
       md5(coalesce(string_agg(md5(c::text), '' order by md5(c::text)), ''))
  from (select * from tw_bsr_fetch_failures where coalesce(updated_at, created_at) >= now() - interval '3 days') c
union all
select 'tw_chip_fact', count(*), max(trade_date)::text,
       md5(coalesce(string_agg(md5(d::text), '' order by md5(d::text)), ''))
  from (select * from tw_chip_fact where trade_date >= current_date - 10) d
order by 1;
