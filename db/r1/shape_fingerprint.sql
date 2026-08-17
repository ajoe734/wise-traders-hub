\pset pager off
\pset tuples_only on
\pset format unaligned
select 'SIGSHAPE|'||status||'|'||action||'|'||coalesce(market,'-')||'|'||coalesce(quantity_unit,'-')||'|'||count(*) from expert_signals group by 1,2,3,4 order by 1;
select 'TRSHAPE|'||status||'|'||coalesce(market,'-')||'|'||coalesce(currency,'-')||'|'||coalesce(quantity_unit,'-')||'|'||is_combo||'|'||count(*) from trade_records group by status,market,currency,quantity_unit,is_combo order by 1;
select 'EXPERT|'||id||'|'||role||'|'||status||'|'||coalesce(asset_class,'-')||'|'||coalesce(currency,'-')||'|'||coalesce(starting_capital::text,'-') from experts order by 1;
select 'LEGS|'||count(*)||'|'||count(distinct signal_id) from expert_signal_legs;
select 'APP|'||tg_op||'|'||count(*) from signal_trade_applications group by tg_op order by 1;
select 'PERF|'||count(*)||'|'||count(distinct user_id) from user_performances;
with sig as (select expert_id, instrument, sum(case action when 'buy' then quantity when 'add' then quantity when 'sell' then -quantity when 'trim' then -quantity else 0 end) net, bool_or(action='exit') ex from expert_signals where status='published' and action<>'teaching' group by 1,2),
tr as (select expert_id, instrument, sum(quantity) filter (where status='open') oq from trade_records group by 1,2)
select 'DRIFT|'||coalesce(s.expert_id,t.expert_id)||'|'||coalesce(s.instrument,t.instrument)||'|'||(coalesce(t.oq,0)-coalesce(case when s.ex then 0 else s.net end,0))
from sig s full join tr t on t.expert_id=s.expert_id and t.instrument=s.instrument
where coalesce(t.oq,0) <> coalesce(case when s.ex then 0 else s.net end,0) order by 1;
select 'NULLQTY|expert_signals|'||count(*) from expert_signals where quantity is null;
select 'NULLQTY|trade_records|'||count(*) from trade_records where quantity is null;
select 'FXGAP|'||coalesce(market,'-')||'|'||coalesce(currency,'-')||'|'||count(*) from trade_records where currency is null or market is null group by market,currency;
