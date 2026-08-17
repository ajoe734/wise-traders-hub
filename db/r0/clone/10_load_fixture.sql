SET session_replication_role = replica;  -- shape-preserving load: no trigger re-derivation
\copy public.experts from '/tmp/r0clone/fixture/experts.csv' csv header
\copy public.expert_signals from '/tmp/r0clone/fixture/expert_signals.csv' csv header
\copy public.expert_signal_legs from '/tmp/r0clone/fixture/expert_signal_legs.csv' csv header
\copy public.trade_records from '/tmp/r0clone/fixture/trade_records.csv' csv header
\copy public.signal_trade_applications from '/tmp/r0clone/fixture/signal_trade_applications.csv' csv header
\copy public.user_performances from '/tmp/r0clone/fixture/user_performances.csv' csv header
SET session_replication_role = origin;
