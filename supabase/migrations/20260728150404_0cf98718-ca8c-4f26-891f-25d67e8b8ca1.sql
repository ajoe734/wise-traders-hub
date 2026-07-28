-- 1) expert_signals combo columns
ALTER TABLE public.expert_signals
  ADD COLUMN IF NOT EXISTS is_combo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_strategy text,
  ADD COLUMN IF NOT EXISTS net_premium numeric,
  ADD COLUMN IF NOT EXISTS max_loss_per_unit numeric,
  ADD COLUMN IF NOT EXISTS max_profit_per_unit numeric;

-- 2) trade_records combo columns
ALTER TABLE public.trade_records
  ADD COLUMN IF NOT EXISTS is_combo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_strategy text,
  ADD COLUMN IF NOT EXISTS net_premium numeric,
  ADD COLUMN IF NOT EXISTS max_loss_per_unit numeric,
  ADD COLUMN IF NOT EXISTS max_profit_per_unit numeric;

-- 3) legs table
CREATE TABLE IF NOT EXISTS public.expert_signal_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.expert_signals(id) ON DELETE CASCADE,
  leg_index integer NOT NULL DEFAULT 0,
  occ_symbol text,
  underlying text NOT NULL,
  expiry date,
  right_type text CHECK (right_type IN ('C','P')),
  strike numeric,
  side text NOT NULL DEFAULT 'long' CHECK (side IN ('long','short')),
  ratio integer NOT NULL DEFAULT 1 CHECK (ratio > 0),
  leg_price numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id, leg_index)
);

CREATE INDEX IF NOT EXISTS idx_expert_signal_legs_signal ON public.expert_signal_legs(signal_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_signal_legs TO authenticated;
GRANT ALL ON public.expert_signal_legs TO service_role;

ALTER TABLE public.expert_signal_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins full access signal legs"
ON public.expert_signal_legs FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'company_admin'))
WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Analysts manage own signal legs"
ON public.expert_signal_legs FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.expert_signals s
  JOIN public.experts e ON e.id = s.expert_id
  WHERE s.id = expert_signal_legs.signal_id AND e.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.expert_signals s
  JOIN public.experts e ON e.id = s.expert_id
  WHERE s.id = expert_signal_legs.signal_id AND e.user_id = auth.uid()
));

CREATE POLICY "Subscribers can view published signal legs"
ON public.expert_signal_legs FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.expert_signals s
  WHERE s.id = expert_signal_legs.signal_id
    AND s.status = 'published'
    AND s.expert_id IN (
      SELECT expert_id FROM public.has_active_subscription_after(auth.uid(), s.published_at)
    )
));

CREATE TRIGGER trg_expert_signal_legs_updated_at
BEFORE UPDATE ON public.expert_signal_legs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) unit whitelist: allow 組 for us_option
CREATE OR REPLACE FUNCTION public.enforce_unit_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_existing_unit    text;
  v_existing_source  text;
  v_existing_row_id  text;
  v_existing_symbol  text;
  v_existing_qty     numeric;
  v_existing_created timestamptz;
  v_asset_class      text;
  v_allowed          text[];
  v_allowed_str      text;
  v_symbol           text;
BEGIN
  IF NEW.quantity_unit IS NULL OR btrim(NEW.quantity_unit) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.quantity_unit IS NOT NULL
     AND OLD.quantity_unit = NEW.quantity_unit
     AND OLD.instrument IS NOT DISTINCT FROM NEW.instrument
     AND OLD.expert_id IS NOT DISTINCT FROM NEW.expert_id THEN
    RETURN NEW;
  END IF;

  IF NEW.expert_id IS NULL OR NEW.instrument IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;
  v_allowed_str := array_to_string(v_allowed, '/');

  IF NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION
      '單位不相容：資產類別「%」不支援單位「%」，允許的單位為「%」。',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'ASSET_UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', asset_class=' || COALESCE(v_asset_class, 'tw_stock')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str;
  END IF;

  -- 組合單（多腿）以「組」為部位單位，與單腿「口」互不衝突，跳過同標的混用檢查
  IF NEW.quantity_unit = '組' OR COALESCE(NEW.is_combo, false) THEN
    RETURN NEW;
  END IF;

  v_symbol := split_part(btrim(NEW.instrument), ' ', 1);

  SELECT quantity_unit, 'expert_signals', id::text,
         split_part(btrim(instrument), ' ', 1), quantity, created_at
    INTO v_existing_unit, v_existing_source, v_existing_row_id,
         v_existing_symbol, v_existing_qty, v_existing_created
  FROM public.expert_signals
  WHERE expert_id = NEW.expert_id
    AND split_part(btrim(instrument), ' ', 1) = v_symbol
    AND quantity_unit IS NOT NULL
    AND quantity_unit <> NEW.quantity_unit
    AND quantity_unit <> '組'
    AND COALESCE(is_combo, false) = false
    AND status = 'pending'
    AND (TG_TABLE_NAME <> 'expert_signals' OR id <> NEW.id)
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_unit IS NULL THEN
    SELECT quantity_unit, 'trade_records', id::text,
           split_part(btrim(instrument), ' ', 1), quantity, created_at
      INTO v_existing_unit, v_existing_source, v_existing_row_id,
           v_existing_symbol, v_existing_qty, v_existing_created
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND split_part(btrim(instrument), ' ', 1) = v_symbol
      AND quantity_unit IS NOT NULL
      AND quantity_unit <> NEW.quantity_unit
      AND quantity_unit <> '組'
      AND COALESCE(is_combo, false) = false
      AND status = 'open'
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 目前已有一筆未平倉部位使用「%」單位（來源：% #%，數量 % %，建立於 %），無法在此代碼上同時混用「%」。允許單位：%。請先平倉，或到週記編輯頁使用「改單位…」把該部位單位校齊。',
      v_symbol,
      v_existing_unit,
      v_existing_source,
      v_existing_row_id,
      v_existing_qty,
      v_existing_unit,
      to_char(v_existing_created AT TIME ZONE 'Asia/Taipei', 'YYYY/MM/DD HH24:MI'),
      NEW.quantity_unit,
      v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', symbol=' || v_symbol
              || ', existing_source=' || v_existing_source
              || ', existing_row_id=' || v_existing_row_id
              || ', existing_unit=' || v_existing_unit
              || ', existing_quantity=' || COALESCE(v_existing_qty::text, '')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str
              || ', scope=open_positions_only';
  END IF;

  RETURN NEW;
END;
$fn$;

-- 5) capital limit: combo uses max_loss, single-leg option uses x100 multiplier
CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_shares numeric;
  v_required numeric;
  v_available numeric;
  v_status jsonb;
  v_currency text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(currency, 'TWD'), COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_currency, v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NEW.quantity_unit IS NOT NULL AND NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, array_to_string(v_allowed, '/')
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(NEW.is_combo, false) THEN
    IF COALESCE(NEW.max_loss_per_unit, 0) <= 0 THEN
      RAISE EXCEPTION 'COMBO_MAX_LOSS_REQUIRED: 組合單必須提供每組最大損失（max_loss_per_unit）才能發布。'
        USING ERRCODE = 'check_violation';
    END IF;
    v_required := NEW.max_loss_per_unit * GREATEST(COALESCE(NEW.quantity, 1), 1);
  ELSE
    v_shares := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'tw_stock' AND COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'us_option' THEN COALESCE(NEW.quantity, 1) * 100
      ELSE COALESCE(NEW.quantity, 1)
    END;
    v_required := COALESCE(NEW.price_hint, 0) * v_shares;
  END IF;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  IF v_required > v_available THEN
    RAISE EXCEPTION
      'CAPITAL_EXCEEDED: 此筆需 % %，可用現金僅 % %。請至「分析師設定」調整初始資金，或減少數量。',
      v_required, COALESCE(v_currency, 'TWD'), v_available, COALESCE(v_currency, 'TWD')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;