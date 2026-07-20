
CREATE TABLE public.tw_bsr_sync_config (
  key text PRIMARY KEY,
  config jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  note text
);

GRANT SELECT ON public.tw_bsr_sync_config TO authenticated;
GRANT ALL ON public.tw_bsr_sync_config TO service_role;

ALTER TABLE public.tw_bsr_sync_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can read bsr sync config"
  ON public.tw_bsr_sync_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "admins can update bsr sync config"
  ON public.tw_bsr_sync_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "admins can insert bsr sync config"
  ON public.tw_bsr_sync_config FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

CREATE TABLE public.tw_bsr_sync_config_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  version integer NOT NULL,
  config jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  note text,
  UNIQUE (key, version)
);

GRANT SELECT ON public.tw_bsr_sync_config_history TO authenticated;
GRANT ALL ON public.tw_bsr_sync_config_history TO service_role;

ALTER TABLE public.tw_bsr_sync_config_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can read bsr sync config history"
  ON public.tw_bsr_sync_config_history FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE OR REPLACE FUNCTION public.tw_bsr_sync_config_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.tw_bsr_sync_config_history (key, version, config, changed_by, note)
    VALUES (NEW.key, NEW.version, NEW.config, NEW.updated_by, NEW.note);
    RETURN NEW;
  END IF;

  IF NEW.config IS DISTINCT FROM OLD.config THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    INSERT INTO public.tw_bsr_sync_config_history (key, version, config, changed_by, note)
    VALUES (NEW.key, NEW.version, NEW.config, NEW.updated_by, NEW.note);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tw_bsr_sync_config_snapshot_trg
BEFORE INSERT OR UPDATE ON public.tw_bsr_sync_config
FOR EACH ROW EXECUTE FUNCTION public.tw_bsr_sync_config_snapshot();

INSERT INTO public.tw_bsr_sync_config (key, config, note)
VALUES (
  'bsr_sync',
  '{
    "ua_pool": [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15"
    ],
    "accept_lang_pool": [
      "zh-TW,zh;q=0.9,en;q=0.8",
      "zh-TW,zh-Hant;q=0.9,en;q=0.7",
      "zh-TW;q=0.9,zh;q=0.8"
    ],
    "max_ocr_retry": 3,
    "ocr_retry_sleep_ms": [1200, 2500],
    "per_stock_sleep_ms": [2500, 5000],
    "backoff_steps_sec": [60, 300, 1800, 7200, 21600],
    "max_consecutive_before_freeze": 4,
    "freeze_window_ms": 86400000,
    "cookie_jar_reuse": 6,
    "lock_ttl_sec": 90
  }'::jsonb,
  'initial seed'
);
