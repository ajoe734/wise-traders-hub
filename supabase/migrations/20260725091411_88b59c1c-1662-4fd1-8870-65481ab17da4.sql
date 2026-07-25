
CREATE OR REPLACE FUNCTION public.enqueue_institutional_new_stock(_stock_id TEXT)
RETURNS TABLE (enqueued BOOLEAN, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cfg JSONB;
  _enabled BOOLEAN;
  _cap INT;
  _today_count INT;
  _existing RECORD;
BEGIN
  IF _stock_id IS NULL OR _stock_id !~ '^[1-9]\d{3}$' THEN
    RETURN QUERY SELECT false, 'invalid_stock_id'::text; RETURN;
  END IF;

  SELECT config INTO _cfg FROM public.tw_bsr_sync_config WHERE key = 'fastlane_enabled';
  _enabled := COALESCE((_cfg->>'enabled')::boolean, false);
  _cap := COALESCE((_cfg->>'daily_stock_cap')::int, 50);
  IF NOT _enabled THEN
    RETURN QUERY SELECT false, 'flag_disabled'::text; RETURN;
  END IF;

  SELECT id, status INTO _existing
    FROM public.institutional_new_stock_queue WHERE stock_id = _stock_id;
  IF FOUND AND _existing.status <> 'dead' THEN
    RETURN QUERY SELECT false, ('already_'||_existing.status)::text; RETURN;
  END IF;

  SELECT COUNT(*) INTO _today_count
    FROM public.institutional_new_stock_queue
   WHERE requested_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei';
  IF _today_count >= _cap THEN
    RETURN QUERY SELECT false, 'daily_cap_reached'::text; RETURN;
  END IF;

  INSERT INTO public.institutional_new_stock_queue (stock_id, status, attempts, next_attempt_at)
       VALUES (_stock_id, 'pending', 0, now())
  ON CONFLICT (stock_id) DO UPDATE
     SET status='pending', attempts=0, next_attempt_at=now(),
         last_error=NULL, updated_at=now();

  RETURN QUERY SELECT true, 'enqueued'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_institutional_new_stock(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_institutional_new_stock(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_institutional_new_stock(_lease_seconds INT DEFAULT 60)
RETURNS TABLE (id UUID, stock_id TEXT, attempts INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.institutional_new_stock_queue q
     SET status='running', attempts=q.attempts+1,
         next_attempt_at=now() + make_interval(secs => _lease_seconds),
         updated_at=now()
   WHERE q.id = (
     SELECT q2.id FROM public.institutional_new_stock_queue q2
      WHERE q2.status='pending' AND q2.next_attempt_at <= now()
      ORDER BY q2.next_attempt_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
   )
  RETURNING q.id, q.stock_id, q.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_institutional_new_stock(INT) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_institutional_new_stock(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_fastlane_stats()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _out JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT jsonb_build_object(
    'config', (SELECT config FROM public.tw_bsr_sync_config WHERE key='fastlane_enabled'),
    'queue', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM (
        SELECT status, COUNT(*)::int cnt
          FROM public.institutional_new_stock_queue GROUP BY status
      ) s
    ),
    'today_enqueued', (
      SELECT COUNT(*)::int FROM public.institutional_new_stock_queue
       WHERE requested_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei'
    ),
    'recent_done', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stock_id', stock_id, 'attempts', attempts, 'updated_at', updated_at
      ))
      FROM (
        SELECT stock_id, attempts, updated_at
          FROM public.institutional_new_stock_queue
         WHERE status='done' AND updated_at >= now() - interval '24 hours'
         ORDER BY updated_at DESC LIMIT 20
      ) d
    ), '[]'::jsonb),
    'recent_failed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stock_id', stock_id, 'attempts', attempts,
        'last_error', last_error, 'updated_at', updated_at
      ))
      FROM (
        SELECT stock_id, attempts, last_error, updated_at
          FROM public.institutional_new_stock_queue
         WHERE (status='dead' OR (status='pending' AND attempts > 0))
           AND last_error IS NOT NULL
           AND updated_at >= now() - interval '24 hours'
         ORDER BY updated_at DESC LIMIT 20
      ) f
    ), '[]'::jsonb)
  ) INTO _out;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_fastlane_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.get_fastlane_stats() TO authenticated;
