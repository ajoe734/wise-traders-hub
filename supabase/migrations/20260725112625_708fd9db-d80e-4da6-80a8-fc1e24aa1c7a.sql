
-- PR-8: FinMind Quota Pools + Admission Control
-- 三 pool 隔離：interactive / keepwarm / backfill
-- 每個 pool 各自 daily_budget，超額 admission 層直接拒

CREATE TABLE public.finmind_quota_pools (
  pool_name TEXT PRIMARY KEY,
  daily_budget INT NOT NULL DEFAULT 100,
  used_today INT NOT NULL DEFAULT 0,
  reset_at DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date,
  priority INT NOT NULL DEFAULT 5,
  last_reject_at TIMESTAMPTZ,
  last_reject_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.finmind_quota_pools TO authenticated;
GRANT ALL ON public.finmind_quota_pools TO service_role;

ALTER TABLE public.finmind_quota_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read finmind quota pools"
  ON public.finmind_quota_pools FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service write finmind quota pools"
  ON public.finmind_quota_pools FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 預填三 pool
INSERT INTO public.finmind_quota_pools (pool_name, daily_budget, priority) VALUES
  ('interactive', 240, 1),
  ('keepwarm',    240, 5),
  ('backfill',    120, 9)
ON CONFLICT (pool_name) DO NOTHING;

-- Ledger：admission 決策稽核（7 日保留）
CREATE TABLE public.finmind_quota_ledger (
  id BIGSERIAL PRIMARY KEY,
  pool_name TEXT NOT NULL,
  request_kind TEXT NOT NULL, -- 'keepwarm_wave1' | 'fastlane' | 'on_demand' ...
  stock_id TEXT,
  granted BOOLEAN NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_finmind_quota_ledger_created ON public.finmind_quota_ledger(created_at DESC);
CREATE INDEX idx_finmind_quota_ledger_pool ON public.finmind_quota_ledger(pool_name, created_at DESC);

GRANT SELECT ON public.finmind_quota_ledger TO authenticated;
GRANT ALL ON public.finmind_quota_ledger TO service_role;

ALTER TABLE public.finmind_quota_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read finmind quota ledger"
  ON public.finmind_quota_ledger FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service write finmind quota ledger"
  ON public.finmind_quota_ledger FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Admission RPC：atomic UPDATE + RETURNING，防超發
CREATE OR REPLACE FUNCTION public.finmind_admit(
  _pool TEXT,
  _kind TEXT DEFAULT 'unknown',
  _stock_id TEXT DEFAULT NULL,
  _cost INT DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.finmind_quota_pools;
  _today DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
  _granted BOOLEAN;
  _reason TEXT;
  _remaining INT;
BEGIN
  -- 原子：若 reset_at 過期則重置 + 判斷 + 扣配額
  UPDATE public.finmind_quota_pools
     SET used_today = CASE WHEN reset_at < _today THEN 0 ELSE used_today END,
         reset_at   = CASE WHEN reset_at < _today THEN _today ELSE reset_at END
   WHERE pool_name = _pool
  RETURNING * INTO _row;

  IF _row.pool_name IS NULL THEN
    INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason)
    VALUES (_pool, _kind, _stock_id, false, 'unknown_pool');
    RETURN jsonb_build_object('granted', false, 'reason', 'unknown_pool');
  END IF;

  IF _row.used_today + _cost > _row.daily_budget THEN
    _granted := false;
    _reason := 'quota_exceeded';
    UPDATE public.finmind_quota_pools
       SET last_reject_at = now(), last_reject_reason = _reason
     WHERE pool_name = _pool;
    _remaining := GREATEST(_row.daily_budget - _row.used_today, 0);
  ELSE
    UPDATE public.finmind_quota_pools
       SET used_today = used_today + _cost, updated_at = now()
     WHERE pool_name = _pool
    RETURNING (daily_budget - used_today) INTO _remaining;
    _granted := true;
    _reason := 'ok';
  END IF;

  INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason)
  VALUES (_pool, _kind, _stock_id, _granted, _reason);

  RETURN jsonb_build_object(
    'granted', _granted,
    'reason', _reason,
    'remaining', _remaining,
    'reset_at', _today + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finmind_admit(TEXT,TEXT,TEXT,INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finmind_admit(TEXT,TEXT,TEXT,INT) TO service_role;

-- 手動調整預算（admin only）
CREATE OR REPLACE FUNCTION public.finmind_pool_set_budget(
  _pool TEXT, _budget INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  UPDATE public.finmind_quota_pools
     SET daily_budget = GREATEST(_budget, 0), updated_at = now()
   WHERE pool_name = _pool;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.finmind_pool_set_budget(TEXT,INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finmind_pool_set_budget(TEXT,INT) TO authenticated;

-- 每日重置（cron 用；也是安全網，admit 內已有 lazy reset）
CREATE OR REPLACE FUNCTION public.finmind_pool_reset()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  UPDATE public.finmind_quota_pools
     SET used_today = 0, reset_at = _today, updated_at = now()
   WHERE reset_at < _today;
  DELETE FROM public.finmind_quota_ledger WHERE created_at < now() - INTERVAL '7 days';
  RETURN jsonb_build_object('ok', true, 'reset_at', _today);
END;
$$;

REVOKE ALL ON FUNCTION public.finmind_pool_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finmind_pool_reset() TO service_role;

-- ============================================
-- PR-9: Kill-switch 系統
-- ============================================
CREATE TABLE public.system_kill_switches (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  disabled_reason TEXT,
  auto_trigger_metric TEXT,
  disabled_at TIMESTAMPTZ,
  disabled_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_kill_switches TO authenticated;
GRANT ALL ON public.system_kill_switches TO service_role;

ALTER TABLE public.system_kill_switches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read kill switches"
  ON public.system_kill_switches FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service manage kill switches"
  ON public.system_kill_switches FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.system_kill_switches (key, enabled) VALUES
  ('chips_keepwarm', true),
  ('chips_backfill', true),
  ('chips_interactive', true),
  ('chips_all', true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.check_kill_switch(_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.system_kill_switches WHERE key = _key),
    true
  ) AND COALESCE(
    (SELECT enabled FROM public.system_kill_switches WHERE key = 'chips_all'),
    true
  );
$$;

REVOKE ALL ON FUNCTION public.check_kill_switch(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_kill_switch(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.toggle_kill_switch(
  _key TEXT, _enabled BOOLEAN, _reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  INSERT INTO public.system_kill_switches (key, enabled, disabled_reason, disabled_at, disabled_by, updated_at)
  VALUES (_key, _enabled, _reason, CASE WHEN _enabled THEN NULL ELSE now() END, auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
    SET enabled = _enabled,
        disabled_reason = CASE WHEN _enabled THEN NULL ELSE COALESCE(_reason, system_kill_switches.disabled_reason) END,
        disabled_at = CASE WHEN _enabled THEN NULL ELSE now() END,
        disabled_by = CASE WHEN _enabled THEN NULL ELSE auth.uid() END,
        updated_at = now();
  RETURN jsonb_build_object('ok', true, 'key', _key, 'enabled', _enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_kill_switch(TEXT,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_kill_switch(TEXT,BOOLEAN,TEXT) TO authenticated;
