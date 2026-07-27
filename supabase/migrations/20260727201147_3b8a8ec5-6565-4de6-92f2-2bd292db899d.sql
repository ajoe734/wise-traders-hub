-- Phase L2-1: 統一 daily_price_snapshots 成交量單位（修正 int overflow）
ALTER TABLE public.daily_price_snapshots
  ALTER COLUMN volume TYPE BIGINT;

ALTER TABLE public.daily_price_snapshots
  ADD COLUMN IF NOT EXISTS volume_unit TEXT,
  ADD COLUMN IF NOT EXISTS volume_shares BIGINT;

COMMENT ON COLUMN public.daily_price_snapshots.volume_unit IS
  'Original unit for volume column: lots (張, TW), shares (股), contracts (口, futures/options), unknown';
COMMENT ON COLUMN public.daily_price_snapshots.volume_shares IS
  'Canonical volume in shares (base unit). BSR coverage / parity checks read this column only.';

UPDATE public.daily_price_snapshots
SET
  volume_unit = CASE
    WHEN volume IS NULL OR volume = 0 THEN 'unknown'
    WHEN market = 'TW' AND volume < 10000000 THEN 'lots'
    WHEN market = 'TW' THEN 'shares'
    WHEN market = 'US' THEN 'shares'
    WHEN market = 'CRYPTO' THEN 'shares'
    ELSE 'unknown'
  END,
  volume_shares = CASE
    WHEN volume IS NULL THEN NULL
    WHEN market = 'TW' AND volume < 10000000 THEN volume::BIGINT * 1000
    ELSE volume::BIGINT
  END
WHERE volume_unit IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_price_snapshots_missing_volume_shares
  ON public.daily_price_snapshots (market, trade_date)
  WHERE volume_shares IS NULL;

CREATE OR REPLACE FUNCTION public.normalize_snapshot_volume_shares(
  p_market TEXT,
  p_volume BIGINT,
  p_hint_unit TEXT DEFAULT NULL
) RETURNS TABLE(unit TEXT, shares BIGINT)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_unit TEXT;
  v_shares BIGINT;
BEGIN
  IF p_volume IS NULL THEN
    RETURN QUERY SELECT 'unknown'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;

  IF p_hint_unit IN ('lots', 'shares', 'contracts') THEN
    v_unit := p_hint_unit;
  ELSIF p_market = 'TW' THEN
    v_unit := CASE WHEN p_volume < 10000000 THEN 'lots' ELSE 'shares' END;
  ELSIF p_market IN ('US', 'CRYPTO') THEN
    v_unit := 'shares';
  ELSE
    v_unit := 'unknown';
  END IF;

  v_shares := CASE WHEN v_unit = 'lots' THEN p_volume * 1000 ELSE p_volume END;
  RETURN QUERY SELECT v_unit, v_shares;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_daily_snapshot_normalize_volume()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n RECORD;
BEGIN
  IF NEW.volume IS NULL THEN
    NEW.volume_unit := COALESCE(NEW.volume_unit, 'unknown');
    NEW.volume_shares := NULL;
    RETURN NEW;
  END IF;

  IF NEW.volume_shares IS NULL OR NEW.volume_unit IS NULL THEN
    SELECT * INTO n FROM public.normalize_snapshot_volume_shares(NEW.market, NEW.volume, NEW.volume_unit);
    NEW.volume_unit := COALESCE(NEW.volume_unit, n.unit);
    NEW.volume_shares := COALESCE(NEW.volume_shares, n.shares);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_snapshot_normalize_volume ON public.daily_price_snapshots;
CREATE TRIGGER daily_snapshot_normalize_volume
  BEFORE INSERT OR UPDATE OF volume, volume_unit, volume_shares, market
  ON public.daily_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.trg_daily_snapshot_normalize_volume();