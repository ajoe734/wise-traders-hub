-- P3 — Sealing 機制修正：bsr_snapshot_mark 在 ready 時自動封存

CREATE OR REPLACE FUNCTION public.bsr_snapshot_mark(
  _trade_date date,
  _status text,
  _source text,
  _coverage_stocks integer,
  _coverage_rows integer,
  _last_error text DEFAULT NULL::text,
  _sealed_by_lane text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE public.tw_bsr_daily_snapshot_status
     SET status = _status,
         source = COALESCE(_source, source),
         fetched_at = CASE WHEN _status IN ('ready','partial') THEN now() ELSE fetched_at END,
         coverage_stocks = GREATEST(coverage_stocks, COALESCE(_coverage_stocks, 0)),
         coverage_rows   = GREATEST(coverage_rows,   COALESCE(_coverage_rows, 0)),
         last_error = _last_error,
         lock_expires_at = NULL,
         -- 只有第一次轉 ready 時封存，避免重複更新時戳
         sealed_at = COALESCE(
           public.tw_bsr_daily_snapshot_status.sealed_at,
           CASE WHEN _status = 'ready' THEN now() ELSE NULL END
         ),
         sealed_by_lane = COALESCE(
           public.tw_bsr_daily_snapshot_status.sealed_by_lane,
           CASE WHEN _status = 'ready' THEN COALESCE(_sealed_by_lane, _source) ELSE NULL END
         )
   WHERE trade_date = _trade_date;
$$;

-- P3 — Fallback 量化：tw_chips_rollup 增加來源日期與 fallback 標記

ALTER TABLE public.tw_chips_rollup
  ADD COLUMN IF NOT EXISTS source_date DATE,
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN;

UPDATE public.tw_chips_rollup
   SET source_date = as_of_date,
       fallback_used = false
 WHERE source_date IS NULL;

ALTER TABLE public.tw_chips_rollup
  ALTER COLUMN source_date SET NOT NULL,
  ALTER COLUMN source_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN fallback_used SET NOT NULL,
  ALTER COLUMN fallback_used SET DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tw_chips_rollup_fallback
  ON public.tw_chips_rollup(as_of_date, fallback_used);

-- 確保未來 INSERT 時 source_date 預設等於 as_of_date，避免程式碼遺漏
CREATE OR REPLACE FUNCTION public.tw_chips_rollup_default_source_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.source_date IS NULL THEN
    NEW.source_date := NEW.as_of_date;
  END IF;
  IF NEW.fallback_used IS NULL THEN
    NEW.fallback_used := false;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tw_chips_rollup_default_source_date_trigger'
  ) THEN
    CREATE TRIGGER tw_chips_rollup_default_source_date_trigger
    BEFORE INSERT ON public.tw_chips_rollup
    FOR EACH ROW EXECUTE FUNCTION public.tw_chips_rollup_default_source_date();
  END IF;
END;
$$;

-- 確保 snapshot immutability trigger 存在於 tw_bsr_daily
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_snapshot_immutability'
  ) THEN
    CREATE OR REPLACE FUNCTION public.enforce_snapshot_immutability()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = 'public'
    AS $func$
    DECLARE
      v_sealed_at timestamptz;
    BEGIN
      SELECT sealed_at INTO v_sealed_at
        FROM public.tw_bsr_daily_snapshot_status
       WHERE trade_date = OLD.trade_date;

      IF v_sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'tw_bsr_daily row for trade_date % is sealed and cannot be modified', OLD.trade_date;
      END IF;

      RETURN NEW;
    END;
    $func$;

    CREATE TRIGGER enforce_snapshot_immutability
    BEFORE UPDATE OR DELETE ON public.tw_bsr_daily
    FOR EACH ROW EXECUTE FUNCTION public.enforce_snapshot_immutability();
  END IF;
END;
$$;
