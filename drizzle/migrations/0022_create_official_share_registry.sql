-- 官方股數名錄（TWSE t187ap03_L／TPEx mopsfin_t187ap03_O）落地表：
-- 官方站台 inline 抓取需 30 秒以上且 TPEx 擋預設 UA，改由 cron 每日同步，估值函式只讀此表。
CREATE TABLE IF NOT EXISTS public.official_share_registry (
  symbol          text PRIMARY KEY,
  par             numeric NOT NULL,
  par_text        text,
  issued_shares   bigint NOT NULL,
  preferred_shares bigint NOT NULL DEFAULT 0,
  paid_in_capital numeric,
  source          text NOT NULL,
  report_date     text,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT official_share_registry_symbol_not_blank CHECK (btrim(symbol) <> ''),
  CONSTRAINT official_share_registry_par_positive CHECK (par > 0),
  CONSTRAINT official_share_registry_issued_positive CHECK (issued_shares > 0)
);

GRANT SELECT ON public.official_share_registry TO authenticated;
GRANT ALL    ON public.official_share_registry TO service_role;

ALTER TABLE public.official_share_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY official_share_registry_read
  ON public.official_share_registry FOR SELECT
  TO authenticated USING (true);

CREATE POLICY official_share_registry_service
  ON public.official_share_registry FOR ALL
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.official_share_registry IS
  '官方公司基本資料名錄（面額／已發行股數／特別股），由 official-registry-sync cron 每日更新；估值分母股數的權威來源。';