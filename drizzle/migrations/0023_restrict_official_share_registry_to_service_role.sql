REVOKE SELECT ON public.official_share_registry FROM authenticated;

DROP POLICY IF EXISTS official_share_registry_read ON public.official_share_registry;

COMMENT ON TABLE public.official_share_registry IS
  '官方公司基本資料名錄（面額／已發行股數／特別股），僅由 service_role 的 official-registry-sync 與 valuation-fundamentals 存取。';