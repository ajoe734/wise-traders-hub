\pset pager off
\echo === A14 SIGNAL SHAPE ===
select count(*) signals, count(distinct expert_id) experts, count(distinct instrument) instruments,
 min(created_at)::date first, max(created_at)::date last, count(*) filter (where is_combo) combos,
 count(*) filter (where market='US') us, count(*) filter (where market='TW') tw from expert_signals;
select coalesce(quantity_unit,'-') unit, coalesce(market,'-') mkt, count(*) from expert_signals group by 1,2 order by 3 desc;
\echo === A15 TRADE SHAPE ===
select count(*) trades, count(distinct expert_id) experts, count(distinct instrument) instr,
 count(*) filter (where status='open') open_n, count(*) filter (where status='closed') closed_n from trade_records;
select status, coalesce(market,'-') mkt, coalesce(currency,'-') ccy, coalesce(quantity_unit,'-') unit, coalesce(is_combo::text,'-') combo, count(*)
from trade_records group by 1,2,3,4,5 order by 6 desc;
\echo === A16 EXPERTS ===
select id, role, status, coalesce(asset_class,'-') ac, coalesce(currency,'-') ccy, starting_capital from experts order by created_at;
\echo === A17 6515 DUPLICATE-EFFECT SHAPE ===
select id, expert_id, instrument, quantity, quantity_unit, status, entry_price, entry_date, signal_id from trade_records where instrument like '6515%' order by entry_date;
select id, expert_id, instrument, action, quantity, quantity_unit, status, executed_at, created_at from expert_signals where instrument like '6515%' order by coalesce(executed_at,created_at);
select * from signal_trade_applications where signal_id in (select id from expert_signals where instrument like '6515%');
\echo === A18 DRIFT MAP (replay vs stored open qty) ===
with sig as (
  select expert_id, instrument, market,
    sum(case action when 'buy' then quantity when 'add' then quantity
                    when 'sell' then -quantity when 'trim' then -quantity else 0 end) as net_qty,
    bool_or(action='exit') as had_exit, count(*) n_sig
  from expert_signals where status='published' and action <> 'teaching' group by 1,2,3),
tr as (
  select expert_id, instrument, sum(quantity) filter (where status='open') as open_qty, count(*) n_tr
  from trade_records group by 1,2)
select coalesce(s.expert_id,t.expert_id) expert, coalesce(s.instrument,t.instrument) instrument, s.market,
  s.net_qty replay_net, s.had_exit, t.open_qty stored_open, s.n_sig, t.n_tr,
  coalesce(t.open_qty,0) - coalesce(case when s.had_exit then 0 else s.net_qty end,0) as delta
from sig s full join tr t on t.expert_id=s.expert_id and t.instrument=s.instrument
where coalesce(t.open_qty,0) <> coalesce(case when s.had_exit then 0 else s.net_qty end,0)
order by 1,2;
