-- R0-E: immutable shadow replay of expert_signals -> expected economic state.
-- READ-ONLY. Fail-closed: any signal with missing price/qty/unit or combo shape => symbol is 'incomplete'.
\pset pager off
\timing off
WITH ev AS (
  SELECT s.id, s.expert_id, s.instrument, s.market, s.action::text AS action,
         s.quantity, coalesce(s.quantity_unit,'-') AS unit, s.price_hint, s.is_combo,
         coalesce(s.executed_at, s.published_at, s.created_at) AS at,
         s.status::text AS status
  FROM expert_signals s
  WHERE s.status = 'published' AND s.action::text <> 'teaching'
), norm AS (
  SELECT *,
    CASE WHEN market='TW' AND unit='張' THEN quantity*1000
         WHEN market='TW' AND unit='股' THEN quantity
         WHEN market='US' THEN quantity
         ELSE NULL END AS shares,
    CASE WHEN action IN ('buy','add') THEN 1 WHEN action IN ('sell','trim','exit') THEN -1 ELSE 0 END AS dir,
    (quantity IS NULL OR price_hint IS NULL OR unit='-' OR is_combo) AS bad
  FROM ev
), ordered AS (
  SELECT *, row_number() OVER (PARTITION BY expert_id, market, instrument ORDER BY at, id) rn FROM norm
), replay AS (
  SELECT expert_id, market, instrument,
    bool_or(bad) AS incomplete,
    count(*) AS n_events,
    sum(CASE WHEN action='exit' THEN 0 ELSE dir*coalesce(shares,0) END) AS net_shares_naive,
    sum(CASE WHEN dir>0 THEN coalesce(shares,0)*coalesce(price_hint,0) ELSE 0 END) AS gross_buy_cash,
    sum(CASE WHEN dir<0 THEN coalesce(shares,0)*coalesce(price_hint,0) ELSE 0 END) AS gross_sell_cash,
    bool_or(action='exit') AS has_exit,
    max(at) AS last_at
  FROM ordered GROUP BY 1,2,3
), stored AS (
  SELECT t.expert_id, t.market, t.instrument,
    sum(CASE WHEN t.status='open' THEN
      CASE WHEN t.market='TW' AND t.quantity_unit='張' THEN t.quantity*1000
           WHEN t.market='TW' THEN t.quantity ELSE t.quantity END ELSE 0 END) AS open_shares,
    count(*) FILTER (WHERE t.status='open') AS open_rows,
    count(*) FILTER (WHERE t.status<>'open') AS closed_rows,
    sum(CASE WHEN t.status='open' THEN coalesce(t.entry_price,0)*
      (CASE WHEN t.market='TW' AND t.quantity_unit='張' THEN t.quantity*1000 ELSE t.quantity END) ELSE 0 END) AS open_cost,
    sum(CASE WHEN t.status<>'open' THEN (coalesce(t.exit_price,0)-coalesce(t.entry_price,0))*
      (CASE WHEN t.market='TW' AND t.quantity_unit='張' THEN t.quantity*1000 ELSE t.quantity END) ELSE 0 END) AS realized_pnl
  FROM trade_records t GROUP BY 1,2,3
)
SELECT coalesce(r.expert_id,s.expert_id) AS expert_id,
       coalesce(r.market,s.market) AS market,
       coalesce(r.instrument,s.instrument) AS instrument,
       coalesce(r.n_events,0) AS events,
       CASE WHEN r.incomplete THEN NULL WHEN r.has_exit THEN 0 ELSE r.net_shares_naive END AS replay_open_shares,
       coalesce(s.open_shares,0) AS stored_open_shares,
       coalesce(s.open_shares,0) - CASE WHEN r.has_exit THEN 0 ELSE coalesce(r.net_shares_naive,0) END AS qty_drift,
       coalesce(s.open_rows,0) AS open_rows, coalesce(s.closed_rows,0) AS closed_rows,
       round(coalesce(s.open_cost,0),2) AS stored_open_cost,
       round(coalesce(r.gross_buy_cash,0)-coalesce(r.gross_sell_cash,0),2) AS replay_net_cash_out,
       round(coalesce(s.realized_pnl,0),2) AS stored_realized_pnl,
       CASE WHEN r.incomplete THEN 'incomplete'
            WHEN r.expert_id IS NULL THEN 'stored_only_no_signal'
            WHEN s.expert_id IS NULL THEN 'signal_only_no_trade'
            WHEN coalesce(s.open_shares,0) = CASE WHEN r.has_exit THEN 0 ELSE r.net_shares_naive END THEN 'match'
            WHEN r.net_shares_naive <> 0 AND coalesce(s.open_shares,0) % nullif(r.net_shares_naive,0) = 0 THEN 'multiple_apply'
            ELSE 'other_drift' END AS verdict
FROM replay r FULL JOIN stored s
  ON s.expert_id=r.expert_id AND s.market IS NOT DISTINCT FROM r.market AND s.instrument=r.instrument
ORDER BY verdict, market, instrument;
