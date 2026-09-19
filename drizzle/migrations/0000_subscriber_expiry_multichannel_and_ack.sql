-- 1) 送達通道紀錄（站內／Email／LINE 各自成敗）
ALTER TABLE public.subscriber_expiry_reminders
  ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) 老師「已處理／已聯繫」標記：橫幅在被處理前不會消失
CREATE TABLE IF NOT EXISTS public.subscriber_expiry_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.member_subscriptions(id) ON DELETE CASCADE,
  acked_by uuid NOT NULL,
  acked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expert_id, subscription_id)
);

GRANT SELECT, INSERT, DELETE ON public.subscriber_expiry_acks TO authenticated;
GRANT ALL ON public.subscriber_expiry_acks TO service_role;

ALTER TABLE public.subscriber_expiry_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner or admin reads acks" ON public.subscriber_expiry_acks;
CREATE POLICY "owner or admin reads acks" ON public.subscriber_expiry_acks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "owner or admin writes acks" ON public.subscriber_expiry_acks;
CREATE POLICY "owner or admin writes acks" ON public.subscriber_expiry_acks
  FOR INSERT TO authenticated
  WITH CHECK (
    acked_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'company_admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "owner or admin clears acks" ON public.subscriber_expiry_acks;
CREATE POLICY "owner or admin clears acks" ON public.subscriber_expiry_acks
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
  );

-- 3) 即將到期：排除已被老師標記處理的訂閱
CREATE OR REPLACE FUNCTION public._expiring_subscriptions_by_expert(_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(expert_id uuid, expert_user_id uuid, expert_name text, expert_slug text, reminder_timezone text, reminder_time time without time zone, local_date date, subscription_id uuid, subscriber_user_id uuid, display_name text, plan_name text, plan_type text, expires_at timestamp with time zone, expires_on date, days_left integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    e.id, e.user_id, e.name, e.slug,
    e.journal_reminder_timezone, e.journal_reminder_time,
    (_now AT TIME ZONE e.journal_reminder_timezone)::date,
    ms.id, ms.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''), '訂閱者'),
    ep.name, ep.plan_type::text, ms.expires_at,
    (ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date,
    ((ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date
      - (_now AT TIME ZONE e.journal_reminder_timezone)::date)::integer
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  LEFT JOIN public.profiles p ON p.user_id = ms.user_id
  WHERE ms.status = 'active'
    AND ms.canceled_at IS NULL
    AND ms.expires_at IS NOT NULL
    AND ms.expires_at > _now
    AND ms.expires_at < _now + interval '9 days'
    AND e.user_id IS NOT NULL
    AND e.status = 'active'
    AND ((ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date
          - (_now AT TIME ZONE e.journal_reminder_timezone)::date) BETWEEN 0 AND 7
    AND NOT EXISTS (
      SELECT 1 FROM public.subscriber_expiry_acks a
      WHERE a.subscription_id = ms.id AND a.expert_id = e.id
    )
$function$;

-- 4) 過期後 24 小時挽回名單（昨天到期、未取消、未續訂、未標記處理）
CREATE OR REPLACE FUNCTION public._churned_subscriptions_by_expert(_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(expert_id uuid, expert_user_id uuid, expert_name text, expert_slug text, reminder_timezone text, reminder_time time without time zone, local_date date, subscription_id uuid, subscriber_user_id uuid, display_name text, plan_name text, plan_type text, expires_at timestamp with time zone, expires_on date, days_left integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    e.id, e.user_id, e.name, e.slug,
    e.journal_reminder_timezone, e.journal_reminder_time,
    (_now AT TIME ZONE e.journal_reminder_timezone)::date,
    ms.id, ms.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''), '訂閱者'),
    ep.name, ep.plan_type::text, ms.expires_at,
    (ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date,
    ((ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date
      - (_now AT TIME ZONE e.journal_reminder_timezone)::date)::integer
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  LEFT JOIN public.profiles p ON p.user_id = ms.user_id
  WHERE ms.canceled_at IS NULL
    AND ms.expires_at IS NOT NULL
    AND ms.expires_at <= _now
    AND ms.expires_at > _now - interval '4 days'
    AND e.user_id IS NOT NULL
    AND e.status = 'active'
    AND ((ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date
          - (_now AT TIME ZONE e.journal_reminder_timezone)::date) = -1
    AND NOT EXISTS (
      SELECT 1
      FROM public.member_subscriptions ms2
      JOIN public.expert_plans ep2 ON ep2.id = ms2.plan_id
      WHERE ms2.user_id = ms.user_id
        AND ep2.expert_id = e.id
        AND ms2.status = 'active'
        AND ms2.canceled_at IS NULL
        AND ms2.expires_at > _now
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.subscriber_expiry_acks a
      WHERE a.subscription_id = ms.id AND a.expert_id = e.id
    )
$function$;

-- 5) claim：同時處理 7 日內到期與過期 24 小時兩種提醒
CREATE OR REPLACE FUNCTION public.claim_subscriber_expiry_reminders(_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batches jsonb;
  v_due_experts integer;
  v_due_subscriptions integer;
BEGIN
  CREATE TEMP TABLE _due ON COMMIT DROP AS
    SELECT 'subscriber_expiry_7d'::text AS reminder_type, x.*
    FROM public._expiring_subscriptions_by_expert(_now) x
    WHERE (_now AT TIME ZONE x.reminder_timezone)::time >= x.reminder_time
    UNION ALL
    SELECT 'subscriber_expiry_churn_24h'::text, y.*
    FROM public._churned_subscriptions_by_expert(_now) y
    WHERE (_now AT TIME ZONE y.reminder_timezone)::time >= y.reminder_time;

  SELECT count(DISTINCT (expert_id::text || ':' || reminder_type)), count(*)
    INTO v_due_experts, v_due_subscriptions FROM _due;

  WITH agg AS (
    SELECT reminder_type, expert_id, expert_user_id, expert_name, expert_slug, local_date,
           count(*)::integer AS subscription_count,
           jsonb_agg(jsonb_build_object(
             'subscription_id', subscription_id,
             'subscriber_user_id', subscriber_user_id,
             'display_name', display_name,
             'plan_name', plan_name,
             'plan_type', plan_type,
             'expires_on', to_char(expires_on, 'YYYY/MM/DD'),
             'days_left', days_left
           ) ORDER BY days_left, expires_at, display_name) AS items
    FROM _due
    GROUP BY reminder_type, expert_id, expert_user_id, expert_name, expert_slug, local_date
  ), claimed AS (
    INSERT INTO public.subscriber_expiry_reminders (expert_id, local_date, reminder_type, subscription_count, payload)
    SELECT expert_id, local_date, reminder_type, subscription_count, items FROM agg
    ON CONFLICT (expert_id, local_date, reminder_type) DO NOTHING
    RETURNING id, expert_id, local_date, reminder_type, subscription_count, payload
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ledger_id', c.id,
           'reminder_type', c.reminder_type,
           'expert_id', c.expert_id,
           'expert_user_id', a.expert_user_id,
           'expert_name', a.expert_name,
           'expert_slug', a.expert_slug,
           'local_date', to_char(c.local_date, 'YYYY-MM-DD'),
           'subscription_count', c.subscription_count,
           'items', c.payload
         )), '[]'::jsonb)
    INTO v_batches
  FROM claimed c
  JOIN agg a ON a.expert_id = c.expert_id AND a.reminder_type = c.reminder_type;

  RETURN jsonb_build_object(
    'due_experts', COALESCE(v_due_experts, 0),
    'due_subscriptions', COALESCE(v_due_subscriptions, 0),
    'claimed', jsonb_array_length(v_batches),
    'deduped', COALESCE(v_due_experts, 0) - jsonb_array_length(v_batches),
    'batches', v_batches
  );
END;
$function$;

-- 6) 老師端名單：到期中 + 過期 24 小時內尚未處理者
CREATE OR REPLACE FUNCTION public.expiring_subscriptions_for_expert(_expert_id uuid)
 RETURNS TABLE(subscription_id uuid, display_name text, plan_name text, plan_type text, expires_at timestamp with time zone, expires_on date, days_left integer, local_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT (public.has_role(v_uid, 'company_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = v_uid))
    INTO v_allowed;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'not owner of expert' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT x.subscription_id, x.display_name, x.plan_name, x.plan_type,
           x.expires_at, x.expires_on, x.days_left, x.local_date
    FROM (
      SELECT * FROM public._expiring_subscriptions_by_expert(now())
      UNION ALL
      SELECT * FROM public._churned_subscriptions_by_expert(now())
    ) x
    WHERE x.expert_id = _expert_id
    ORDER BY x.days_left ASC, x.expires_at ASC, x.display_name ASC;
END;
$function$;

-- 7) 標記／取消標記「已聯繫」
CREATE OR REPLACE FUNCTION public.ack_subscriber_expiry(_subscription_id uuid, _ack boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expert_id uuid;
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT ep.expert_id INTO v_expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  WHERE ms.id = _subscription_id;

  IF v_expert_id IS NULL THEN
    RAISE EXCEPTION 'subscription not found' USING ERRCODE = '22023';
  END IF;

  SELECT (public.has_role(v_uid, 'company_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = v_expert_id AND e.user_id = v_uid))
    INTO v_allowed;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'not owner of expert' USING ERRCODE = '42501';
  END IF;

  IF _ack THEN
    INSERT INTO public.subscriber_expiry_acks (expert_id, subscription_id, acked_by)
    VALUES (v_expert_id, _subscription_id, v_uid)
    ON CONFLICT (expert_id, subscription_id) DO NOTHING;
  ELSE
    DELETE FROM public.subscriber_expiry_acks
    WHERE expert_id = v_expert_id AND subscription_id = _subscription_id;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.ack_subscriber_expiry(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_subscriber_expiry(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._churned_subscriptions_by_expert(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._churned_subscriptions_by_expert(timestamptz) TO service_role;