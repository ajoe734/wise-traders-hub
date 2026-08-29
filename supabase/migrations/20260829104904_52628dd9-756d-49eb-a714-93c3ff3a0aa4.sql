SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.checkup_trade_memos
  ADD COLUMN IF NOT EXISTS sort_index integer;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC, id DESC
         ) - 1 AS rn
  FROM public.checkup_trade_memos
)
UPDATE public.checkup_trade_memos t
SET sort_index = r.rn
FROM ranked r
WHERE t.id = r.id AND t.sort_index IS DISTINCT FROM r.rn;

ALTER TABLE public.checkup_trade_memos ALTER COLUMN sort_index SET DEFAULT 0;
UPDATE public.checkup_trade_memos SET sort_index = 0 WHERE sort_index IS NULL;
ALTER TABLE public.checkup_trade_memos ALTER COLUMN sort_index SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkup_trade_memos_sort_index_nonneg_chk'
      AND conrelid = 'public.checkup_trade_memos'::regclass
  ) THEN
    ALTER TABLE public.checkup_trade_memos
      ADD CONSTRAINT checkup_trade_memos_sort_index_nonneg_chk CHECK (sort_index >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_checkup_trade_memos_user_sort
  ON public.checkup_trade_memos (user_id, sort_index, created_at DESC, id DESC);