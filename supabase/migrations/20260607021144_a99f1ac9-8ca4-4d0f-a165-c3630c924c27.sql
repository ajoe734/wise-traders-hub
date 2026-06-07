-- E-IDEM-002: refresh-targets-weekly 雙跑去重
-- 同一 user_id + code + firm + report_date + target 視為同一筆事實，重複入庫沒意義
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tph_dedupe
  ON public.target_price_history (user_id, code, firm, report_date, target)
  WHERE report_date IS NOT NULL;