ALTER TABLE public.traffic_visits ADD COLUMN IF NOT EXISTS visits integer NOT NULL DEFAULT 1;
ALTER TABLE public.traffic_visits ADD COLUMN IF NOT EXISTS metrics_version smallint NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.traffic_visits.page_views IS 'metrics_version=1: actually visit count; metrics_version>=2: real page-view count';
COMMENT ON COLUMN public.traffic_visits.visits IS 'Visit (30-min session start) count, from metrics_version 2';