-- P0_SIGNAL_MATH_CONTRACT_V1 — SQL 端 contract vectors 執行（零 production mutation）
--
-- 向量來源：src/lib/signalMath.contract.json（單一資料源，TS/SQL 共用）。
-- 執行方式：整份丟給 run_sql。最後 DO block 一定 RAISE EXCEPTION 輸出報告，
-- 整個 transaction 必定 ROLLBACK：不寫任何正式資料。

BEGIN;

-- 內聯 db/p0-signal-math/signal_math_functions.sql 的函式（逐字相同，僅去 REVOKE/GRANT）
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
      'shares', _shares, 'effectiveShares', _shares,
      'cashDelta', _cash_delta, 'newQty', _new_qty, 'newAvg', _new_avg,
      'positionCost', ROUND(_new_qty * _new_avg, 2)
    );
  END IF;

  IF _action IN ('sell', 'trim', 'exit') THEN
    _effective := CASE WHEN _action = 'exit' THEN _prior_qty ELSE LEAST(_shares, _prior_qty) END;
    _cash_delta := ROUND(COALESCE(_price, 0) * _effective, 2);
    _new_qty := _prior_qty - _effective;
    _new_avg := CASE WHEN _new_qty > 0 THEN _prior_avg ELSE 0 END;
    RETURN jsonb_build_object(
      'shares', _shares, 'effectiveShares', _effective,
      'cashDelta', _cash_delta, 'newQty', _new_qty, 'newAvg', _new_avg,
      'realizedPnl', ROUND((COALESCE(_price, 0) - _prior_avg) * _effective, 2),
      'pnlPercent', CASE WHEN _prior_avg > 0
        THEN ROUND(((COALESCE(_price, 0) - _prior_avg) / _prior_avg) * 100, 2)
        ELSE 0 END
    );
  END IF;

  RETURN jsonb_build_object(
    'shares', _shares, 'effectiveShares', 0,
    'cashDelta', 0, 'newQty', _prior_qty, 'newAvg', _prior_avg
  );
END;
$function$;

DO $$
DECLARE
  _vectors jsonb := $vectors$
[
  {"id":"v1-buy-2-lots-00708L","action":"buy","price":77.7,"quantity":2,"unit":"張","priorQtyShares":0,"priorAvg":0,
   "expected":{"shares":2000,"cashDelta":-155400,"newQty":2000,"newAvg":77.7,"positionCost":155400}},
  {"id":"v2-buy-1-lot-6706","action":"buy","price":123,"quantity":1,"unit":"張","priorQtyShares":0,"priorAvg":0,
   "expected":{"shares":1000,"cashDelta":-123000,"newQty":1000,"newAvg":123,"positionCost":123000}},
  {"id":"v3-sell-1-lot-6706-realized","action":"sell","price":143,"quantity":1,"unit":"張","priorQtyShares":1000,"priorAvg":123,
   "expected":{"shares":1000,"cashDelta":143000,"newQty":0,"newAvg":0,"realizedPnl":20000,"pnlPercent":16.26}},
  {"id":"v4-exit-uses-exit-price-not-cost","action":"exit","price":150,"quantity":1000,"unit":"股","priorQtyShares":1000,"priorAvg":100,
   "expected":{"shares":1000,"cashDelta":150000,"newQty":0,"newAvg":0,"realizedPnl":50000,"pnlPercent":50}},
  {"id":"v5-partial-sell-keeps-avg","action":"sell","price":60,"quantity":500,"unit":"股","priorQtyShares":2000,"priorAvg":50,
   "expected":{"shares":500,"cashDelta":30000,"newQty":1500,"newAvg":50,"realizedPnl":5000,"pnlPercent":20}},
  {"id":"v6-add-weighted-avg","action":"add","price":120,"quantity":1,"unit":"張","priorQtyShares":1000,"priorAvg":100,
   "expected":{"shares":1000,"cashDelta":-120000,"newQty":2000,"newAvg":110,"positionCost":220000}},
  {"id":"v7-orphan-3006-pnl","action":"sell","price":238,"quantity":1,"unit":"張","priorQtyShares":1000,"priorAvg":174,
   "expected":{"shares":1000,"cashDelta":238000,"newQty":0,"newAvg":0,"realizedPnl":64000,"pnlPercent":36.78}},
  {"id":"v8-orphan-6526-pnl","action":"sell","price":752,"quantity":500,"unit":"股","priorQtyShares":500,"priorAvg":585,
   "expected":{"shares":500,"cashDelta":376000,"newQty":0,"newAvg":0,"realizedPnl":83500,"pnlPercent":28.55}},
  {"id":"v9-orphan-3035-pnl","action":"sell","price":207.5,"quantity":1,"unit":"張","priorQtyShares":1000,"priorAvg":169,
   "expected":{"shares":1000,"cashDelta":207500,"newQty":0,"newAvg":0,"realizedPnl":38500,"pnlPercent":22.78}},
  {"id":"v10-zero-quantity-noop","action":"buy","price":100,"quantity":0,"unit":"股","priorQtyShares":1000,"priorAvg":90,
   "expected":{"shares":0,"cashDelta":0,"newQty":1000,"newAvg":90}},
  {"id":"v11-sell-caps-at-holding","action":"sell","price":200,"quantity":2,"unit":"張","priorQtyShares":1000,"priorAvg":180,
   "expected":{"shares":2000,"effectiveSellShares":1000,"cashDelta":200000,"newQty":0,"newAvg":0,"realizedPnl":20000,"pnlPercent":11.11}},
  {"id":"v12-rounding-half-up","action":"sell","price":10.125,"quantity":1,"unit":"股","priorQtyShares":1,"priorAvg":10,
   "expected":{"shares":1,"cashDelta":10.13,"newQty":0,"newAvg":0,"realizedPnl":0.13,"pnlPercent":1.25}}
]
$vectors$;
  _v jsonb;
  _e jsonb;
  _r jsonb;
  _pass integer := 0;
  _fail integer := 0;
  _report text := '';
  _key text;
  _exp numeric;
  _act numeric;
  _keys text[] := ARRAY['shares','effectiveShares','cashDelta','newQty','newAvg','positionCost','realizedPnl','pnlPercent'];
  _exp_key text;
BEGIN
  FOR _v IN SELECT * FROM jsonb_array_elements(_vectors)
  LOOP
    _e := _v -> 'expected';
    _r := public.signal_math_apply(
      _v ->> 'action',
      (_v ->> 'price')::numeric,
      (_v ->> 'quantity')::numeric,
      _v ->> 'unit',
      (_v ->> 'priorQtyShares')::numeric,
      (_v ->> 'priorAvg')::numeric
    );
    DECLARE
      _ok boolean := true;
      _detail text := '';
    BEGIN
      FOREACH _key IN ARRAY _keys LOOP
        -- effectiveSellShares 對應函式輸出的 effectiveShares
        _exp_key := CASE WHEN _key = 'effectiveShares' THEN 'effectiveSellShares' ELSE _key END;
        IF _e ? _exp_key THEN
          _exp := (_e ->> _exp_key)::numeric;
          _act := (_r ->> _key)::numeric;
          IF _act IS DISTINCT FROM _exp THEN
            _ok := false;
            _detail := _detail || format(' %s: expected=%s actual=%s;', _key, _exp, coalesce(_r ->> _key, 'NULL'));
          END IF;
        END IF;
      END LOOP;
      IF _ok THEN
        _pass := _pass + 1;
        _report := _report || format('PASS %s', _v ->> 'id') || E'\n';
      ELSE
        _fail := _fail + 1;
        _report := _report || format('FAIL %s ::%s', _v ->> 'id', _detail) || E'\n';
      END IF;
    END;
  END LOOP;

  -- 一定 RAISE EXCEPTION：強制 ROLLBACK，順便把報告帶出來
  RAISE EXCEPTION '%', format(
    'SIGNAL_MATH_CONTRACT_V1 REPORT (rollback, zero mutation) pass=%s fail=%s%s%s',
    _pass, _fail, E'\n', _report
  );
END;
$$;
