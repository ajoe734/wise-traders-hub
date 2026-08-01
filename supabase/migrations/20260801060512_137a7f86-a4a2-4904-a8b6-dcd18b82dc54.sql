SELECT public.rebuild_bsr_rollup(d::date, NULL, 500)
  FROM generate_series('2026-07-28'::date, '2026-07-31'::date, interval '1 day') d;