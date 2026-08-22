-- clone-only: install the exact production preimage of tw_bsr_sync_config.market_batch (v7)
DELETE FROM public.tw_bsr_sync_config WHERE key = 'market_batch';
INSERT INTO public.tw_bsr_sync_config(key, version, config)
VALUES ('market_batch', 7, jsonb_build_object(
  'enabled', true,
  'probed_at', '2026-08-17T13:30:58.060Z',
  'supported', false,
  'last_probe_at', '2026-08-17T13:30:58.060Z',
  'last_probe_error', 'unsupported_plan:http_400:{"msg":"Your level is register. Please update your user level. Detail information:https://finmindtrade.com/analysis/#/Sponsor/sponsor","status":400,"token_tail":"***"}',
  'last_probe_format', NULL,
  'threshold_pending', 15,
  'last_probe_outcome', 'unsupported',
  'min_stocks_in_response', 500));
SELECT 'seed_md5', version, md5(config::text) FROM public.tw_bsr_sync_config WHERE key='market_batch';
