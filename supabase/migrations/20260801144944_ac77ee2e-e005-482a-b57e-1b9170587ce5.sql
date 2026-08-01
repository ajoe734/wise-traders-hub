SELECT public.rebuild_bsr_rollup(d, NULL::text[], 2000)
FROM unnest(ARRAY['2026-07-30','2026-07-29','2026-07-28']::date[]) AS d;