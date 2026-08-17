-- R1-B: shape-preserving fixture load (replica mode: no trigger re-derivation)
SET session_replication_role = replica;
\copy public.experts from '/tmp/r1fixture/experts.csv' csv header
\copy public.expert_signals from '/tmp/r1fixture/expert_signals.csv' csv header
\copy public.expert_signal_legs from '/tmp/r1fixture/expert_signal_legs.csv' csv header
\copy public.trade_records from '/tmp/r1fixture/trade_records.csv' csv header
\copy public.signal_trade_applications from '/tmp/r1fixture/signal_trade_applications.csv' csv header
\copy public.user_performances from '/tmp/r1fixture/user_performances.csv' csv header
\copy public.daily_price_snapshots from '/tmp/r1fixture/daily_price_snapshots.csv' csv header
\copy public.fx_rates from '/tmp/r1fixture/fx_rates.csv' csv header
\copy public.tw_market_holidays from '/tmp/r1fixture/tw_market_holidays.csv' csv header
SET session_replication_role = origin;
