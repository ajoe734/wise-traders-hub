-- ============================================================================
-- SUBSCRIBER_EXPIRY_TEACHER_REMINDER_V1  (pending apply — 交由 supabase--migration 套用)
-- 訂閱者即將到期（老師當地日 0–7 天）→ 於老師每日週記撰寫時間發一則彙總站內通知。
--
-- 1. experts.journal_reminder_time / journal_reminder_timezone（預設 Asia/Taipei 18:00）
-- 2. subscriber_expiry_reminders：dedupe ledger（expert_id + local_date + reminder_type 唯一）
-- 3. _expiring_subscriptions_by_expert()：唯一的「即將到期」query（老師 tz 本地日計算）
-- 4. expiring_subscriptions_for_expert(_expert_id)：owner / company_admin 才能讀，server-side 檢查
-- 5. claim_subscriber_expiry_reminders(_now)：worker 用；原子 claim（ledger insert）＋回傳彙總
-- 6. pg_cron 每小時呼叫 Edge `subscriber-expiry-teacher-reminder`
-- 可重入：所有 DDL 皆 IF NOT EXISTS / OR REPLACE。
-- ============================================================================

-- 1. per-teacher 撰寫提醒時間
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS journal_reminder_time time without time zone NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS journal_reminder_timezone text NOT NULL DEFAULT 'Asia/Taipei';

CREATE OR REPLACE FUNCTION public.validate_journal_reminder_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.journal_reminder_timezone IS NULL OR btrim(NEW.journal_reminder_timezone) = '' THEN
    RAISE EXCEPTION 'journal_reminder_timezone is required';
  END IF;
  PERFORM now() AT TIME ZONE NEW.journal_reminder_timezone; -- 無效時區直接丟錯
  IF NEW.journal_reminder_time IS NULL THEN
    NEW.journal_reminder_time := '18:00';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_journal_reminder_settings ON public.experts;
CREATE TRIGGER trg_validate_journal_reminder_settings
  BEFORE INSERT OR UPDATE OF journal_reminder_time, journal_reminder_timezone ON public.experts
  FOR EACH ROW EXECUTE FUNCTION public.validate_journal_reminder_settings();

-- 排程掃描只走這個索引範圍
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_active_expiring
  ON public.member_subscriptions (expires_at)
  WHERE status = 'active' AND canceled_at IS NULL AND expires_at IS NOT NULL;

-- 2. dedupe ledger
CREATE TABLE IF NOT EXISTS public.subscriber_expiry_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  reminder_type text NOT NULL DEFAULT 'subscriber_expiry_7d',
  notification_id uuid NULL,
  subscription_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expert_id, local_date, reminder_type)
);

GRANT SELECT ON public.subscriber_expiry_reminders TO authenticated;
GRANT ALL ON public.subscriber_expiry_reminders TO service_role;

ALTER TABLE public.subscriber_expiry_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Analysts view own expiry reminders" ON public.subscriber_expiry_reminders;
CREATE POLICY "Analysts view own expiry reminders"
  ON public.subscriber_expiry_reminders FOR SELECT TO authenticated
  USING (expert_id IN (SELECT e.id FROM public.experts e WHERE e.user_id = auth.uid()));

DROP POLICY IF EXISTS "Company admins view all expiry reminders" ON public.subscriber_expiry_reminders;
CREATE POLICY "Company admins view all expiry reminders"
  ON public.subscriber_expiry_reminders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::app_role));

DROP TRIGGER IF EXISTS update_subscriber_expiry_reminders_updated_at ON public.subscriber_expiry_reminders;
CREATE TRIGGER update_subscriber_expiry_reminders_updated_at
  BEFORE UPDATE ON public.subscriber_expiry_reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. 即將到期 query 單一資料源（內部；不對 API 角色開放）
--    days_left = (expires_at 在老師 tz 的日期) - (_now 在老師 tz 的日期)，0..7
--    只看 member_subscriptions；checkup_subscriptions 是另一張表，天然排除
CREATE OR REPLACE FUNCTION public._expiring_subscriptions_by_expert(_now timestamptz DEFAULT now())
RETURNS TABLE (
  expert_id uuid, expert_user_id uuid, expert_name text, expert_slug text,
  reminder_timezone text, reminder_time time, local_date date,
  subscription_id uuid, subscriber_user_id uuid, display_name text,
  plan_name text, plan_type text, expires_at timestamptz, expires_on date, days_left integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
    AND ms.expires_at < _now + interval '9 days'   -- 索引粗篩；精確篩選在下一行
    AND e.user_id IS NOT NULL
    AND e.status = 'active'
    AND ((ms.expires_at AT TIME ZONE e.journal_reminder_timezone)::date
          - (_now AT TIME ZONE e.journal_reminder_timezone)::date) BETWEEN 0 AND 7
$$;

REVOKE ALL ON FUNCTION public._expiring_subscriptions_by_expert(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._expiring_subscriptions_by_expert(timestamptz) TO service_role;

-- 4. 老師撰寫頁／通知中心讀取：owner 或 company_admin。不回傳 email / line id。
CREATE OR REPLACE FUNCTION public.expiring_subscriptions_for_expert(_expert_id uuid)
RETURNS TABLE (
  subscription_id uuid, display_name text, plan_name text, plan_type text,
  expires_at timestamptz, expires_on date, days_left integer, local_date date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
    FROM public._expiring_subscriptions_by_expert(now()) x
    WHERE x.expert_id = _expert_id
    ORDER BY x.days_left ASC, x.expires_at ASC, x.display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.expiring_subscriptions_for_expert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expiring_subscriptions_for_expert(uuid) TO authenticated, service_role;

-- 5. worker claim：對「已到撰寫提醒時間且今日尚未產生」的老師原子寫入 ledger 並回傳彙總。
--    重跑：ON CONFLICT DO NOTHING → 不重複回傳、不重複插入通知。
--    Edge 插入 notifications 失敗時 DELETE ledger row 讓下次重試。
CREATE OR REPLACE FUNCTION public.claim_subscriber_expiry_reminders(_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_batches jsonb;
  v_due_experts integer;
  v_due_subscriptions integer;
BEGIN
  CREATE TEMP TABLE _due ON COMMIT DROP AS
    SELECT x.*
    FROM public._expiring_subscriptions_by_expert(_now) x
    WHERE (_now AT TIME ZONE x.reminder_timezone)::time >= x.reminder_time;

  SELECT count(DISTINCT expert_id), count(*) INTO v_due_experts, v_due_subscriptions FROM _due;

  WITH agg AS (
    SELECT expert_id, expert_user_id, expert_name, expert_slug, local_date,
           count(*)::integer AS subscription_count,
           jsonb_agg(jsonb_build_object(
             'subscription_id', subscription_id,
             'display_name', display_name,
             'plan_name', plan_name,
             'plan_type', plan_type,
             'expires_on', to_char(expires_on, 'YYYY/MM/DD'),
             'days_left', days_left
           ) ORDER BY days_left, expires_at, display_name) AS items
    FROM _due
    GROUP BY expert_id, expert_user_id, expert_name, expert_slug, local_date
  ), claimed AS (
    INSERT INTO public.subscriber_expiry_reminders (expert_id, local_date, reminder_type, subscription_count, payload)
    SELECT expert_id, local_date, 'subscriber_expiry_7d', subscription_count, items FROM agg
    ON CONFLICT (expert_id, local_date, reminder_type) DO NOTHING
    RETURNING id, expert_id, local_date, subscription_count, payload
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ledger_id', c.id,
           'expert_id', c.expert_id,
           'expert_user_id', a.expert_user_id,
           'expert_name', a.expert_name,
           'expert_slug', a.expert_slug,
           'local_date', to_char(c.local_date, 'YYYY-MM-DD'),
           'subscription_count', c.subscription_count,
           'items', c.payload
         )), '[]'::jsonb)
    INTO v_batches
  FROM claimed c JOIN agg a ON a.expert_id = c.expert_id;

  DROP TABLE IF EXISTS _due;

  RETURN jsonb_build_object(
    'due_experts', COALESCE(v_due_experts, 0),
    'due_subscriptions', COALESCE(v_due_subscriptions, 0),
    'claimed', jsonb_array_length(v_batches),
    'deduped', COALESCE(v_due_experts, 0) - jsonb_array_length(v_batches),
    'batches', v_batches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_subscriber_expiry_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscriber_expiry_reminders(timestamptz) TO service_role;

-- 6. 每小時 :05 掃一次（24 次／日）；Edge 內依老師 tz 判斷是否已到撰寫時間，同日只發一次。
DO $$ BEGIN
  PERFORM cron.unschedule('subscriber-expiry-teacher-reminder-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'subscriber-expiry-teacher-reminder-hourly',
  '5 * * * *',
  $$SELECT public.cron_edge_call('subscriber-expiry-teacher-reminder', '{}'::jsonb);$$
);
