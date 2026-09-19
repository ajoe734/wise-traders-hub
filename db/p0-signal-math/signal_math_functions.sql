-- SIGNAL_MATH_CONTRACT_V1 — SQL 端 canonical calculator（鏡像 src/lib/signalTradeLogic.ts applySignalMathVector）
--
-- 口徑憲法（與 TS 端逐字一致）：
--   - 內部單位一律「股」；「張→股」只能在入口換算一次（×1000）。
--   - 現金：buy/add 扣 成交價×股數；sell/trim/exit 一律以「實際成交價×實際股數」回收
--     （已實現損益因此進入現金），絕不得用成本價釋放。
--   - 金額輸出一律 ROUND(x, 2)。
--
-- contract vectors 單一資料源：src/lib/signalMath.contract.json
--   TS 端：src/test/unit/signal-math-contract.test.ts
--   SQL 端：db/p0-signal-math/090_scenarios.sql（rollback 執行，零 production mutation）
--
-- 本檔為 migration 內容的暫存（P0 規則：核准前不得套用正式環境）。
-- 核准上線時原樣進 supabase/migrations/。

CREATE OR REPLACE FUNCTION public.signal_math_apply(
  _action text,
  _price numeric,
  _quantity numeric,
  _unit text,
  _prior_qty_shares numeric,
  _prior_avg numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _shares numeric;
  _effective numeric;
  _prior_qty numeric := GREATEST(0, COALESCE(_prior_qty_shares, 0));
  _prior_avg numeric := COALESCE(_prior_avg, 0);
  _cash_delta numeric;
  _new_qty numeric;
  _new_avg numeric;
BEGIN
  -- 入口唯一一次單位換算
  _shares := CASE
    WHEN COALESCE(_quantity, 0) <= 0 THEN 0
    WHEN _unit = '張' THEN FLOOR(_quantity) * 1000
    ELSE FLOOR(_quantity)
  END;

  IF _action IN ('buy', 'add') THEN
    _cash_delta := -ROUND(COALESCE(_price, 0) * _shares, 2);
    _new_qty := _prior_qty + _shares;
    _new_avg := CASE
      WHEN _prior_qty > 0 AND _new_qty > 0
        THEN ROUND((_prior_qty * _prior_avg + _shares * COALESCE(_price, 0)) / _new_qty, 2)
      ELSE ROUND(COALESCE(_price, 0), 2)
    END;
    RETURN jsonb_build_object(
      'shares', _shares,
      'effectiveShares', _shares,
      'cashDelta', _cash_delta,
      'newQty', _new_qty,
      'newAvg', _new_avg,
      'positionCost', ROUND(_new_qty * _new_avg, 2)
    );
  END IF;

  IF _action IN ('sell', 'trim', 'exit') THEN
    -- 實際成交股數：sell/trim 以持有量為上限；exit 為全部持有
    _effective := CASE WHEN _action = 'exit' THEN _prior_qty ELSE LEAST(_shares, _prior_qty) END;
    -- 現金回收一律用「實際成交價 × 實際股數」（含已實現損益），不用成本價
    _cash_delta := ROUND(COALESCE(_price, 0) * _effective, 2);
    _new_qty := _prior_qty - _effective;
    _new_avg := CASE WHEN _new_qty > 0 THEN _prior_avg ELSE 0 END;
    RETURN jsonb_build_object(
      'shares', _shares,
      'effectiveShares', _effective,
      'cashDelta', _cash_delta,
      'newQty', _new_qty,
      'newAvg', _new_avg,
      'realizedPnl', ROUND((COALESCE(_price, 0) - _prior_avg) * _effective, 2),
      'pnlPercent', CASE WHEN _prior_avg > 0
        THEN ROUND(((COALESCE(_price, 0) - _prior_avg) / _prior_avg) * 100, 2)
        ELSE 0 END
    );
  END IF;

  -- hold / teaching / 未知：不產生現金流、不動部位
  RETURN jsonb_build_object(
    'shares', _shares,
    'effectiveShares', 0,
    'cashDelta', 0,
    'newQty', _prior_qty,
    'newAvg', _prior_avg
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.signal_math_apply(text, numeric, numeric, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.signal_math_apply(text, numeric, numeric, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.signal_math_apply(text, numeric, numeric, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.signal_math_apply(text, numeric, numeric, text, numeric, numeric) TO service_role;
