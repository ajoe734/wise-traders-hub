#!/usr/bin/env bash
# R0-B: anonymized fixture export (read-only). PII columns are hashed or nulled.
set -e
OUT=${1:-/tmp/r0clone/fixture}
mkdir -p "$OUT"
anon_uuid() { echo "md5(('r0salt'||coalesce($1::text,'nil')))::uuid"; }

psql -q -c "\copy (select id, $(anon_uuid user_id) as user_id, 'expert-'||left(id::text,8) as slug,
 'Expert '||left(id::text,4) as name, role, null::text bio, null::text description, style_tags, markets,
 null::text avatar_url, status, null::uuid created_by, created_at, null::text strategy_summary,
 backtest_1y_return, backtest_max_drawdown, backtest_annual_return, starting_capital, risk_preference,
 operation_cycle, strategy_name, currency, asset_class from experts) to '$OUT/experts.csv' csv header"

psql -q -c "\copy (select id, expert_id, null::uuid plan_id, instrument, action, price_hint,
 '(redacted)' reason_summary, null::text reason_detail, null::text risk_notes, case when learning_points is not null then '(redacted)' else null end as learning_points,
 status, taken_down_reason, null::uuid taken_down_by, published_at, created_at, line_pushed_at, quantity, quantity_unit,
 teaching_topic, null::text overall_summary, batch_id, executed_at, market, is_combo, combo_strategy, net_premium,
 max_loss_per_unit, max_profit_per_unit from expert_signals) to '$OUT/expert_signals.csv' csv header"

psql -q -c "\copy (select * from expert_signal_legs) to '$OUT/expert_signal_legs.csv' csv header"
psql -q -c "\copy (select * from trade_records) to '$OUT/trade_records.csv' csv header"
psql -q -c "\copy (select * from signal_trade_applications) to '$OUT/signal_trade_applications.csv' csv header"
psql -q -c "\copy (select $(anon_uuid user_id) as user_id, symbol, name, current_price, pnl, pnl_percent, updated_at, signal_id, entry_price from user_performances) to '$OUT/user_performances.csv' csv header"
wc -l "$OUT"/*.csv
