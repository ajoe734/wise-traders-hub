-- Phase 4: TW post-close correction shifted from 14:00 → 14:05 TPE (UTC 06:05)
-- The 13:35 pass now becomes an intraday tail snapshot; 14:05 is the authoritative close.
SELECT cron.unschedule('tw-price-sync-close-correction');
SELECT cron.schedule(
  'tw-price-sync-close-correction',
  '5 6 * * 1-5',
  $$SELECT public.cron_edge_call('stock-price-sync', '{"source": "cron-close-correction", "market": "TW"}'::jsonb);$$
);

-- Phase 1: US Option daily close mark-price sync
-- EDT (Mar-Nov, UTC-4): 16:10 ET = 20:10 UTC
-- EST (Nov-Mar, UTC-5): 16:10 ET = 21:10 UTC
-- Function itself decides whether to run based on America/New_York local time.
SELECT cron.schedule(
  'us-option-price-sync-edt',
  '10 20 * * 1-5',
  $$SELECT public.cron_edge_call('us-option-price-sync', '{"source": "cron-close-edt"}'::jsonb);$$
);
SELECT cron.schedule(
  'us-option-price-sync-est',
  '10 21 * * 1-5',
  $$SELECT public.cron_edge_call('us-option-price-sync', '{"source": "cron-close-est"}'::jsonb);$$
);