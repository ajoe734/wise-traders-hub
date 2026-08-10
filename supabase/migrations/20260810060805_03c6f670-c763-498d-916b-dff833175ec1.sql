REVOKE ALL ON FUNCTION public.checkup_prefetch_universe() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkup_prefetch_universe() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_chips_prefetch_gaps(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_chips_prefetch_gaps(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.recover_stale_bsr_queue_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_bsr_queue_jobs(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.detect_chip_gap_jobs(date, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_chip_gap_jobs(date, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.detect_institutional_gap_jobs(date, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_institutional_gap_jobs(date, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.chips_prefetch_targets_touch() FROM PUBLIC, anon, authenticated;

UPDATE public.chips_prefetch_targets
   SET reason = 'unsupported_asset_type'
 WHERE supported = false AND code !~ '^[1-9][0-9]{3}$';
