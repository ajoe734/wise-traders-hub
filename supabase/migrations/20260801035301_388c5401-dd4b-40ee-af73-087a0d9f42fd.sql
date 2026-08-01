REVOKE ALL ON FUNCTION public.tw_detect_market_holidays(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tw_detect_market_holidays(date, date) TO service_role;