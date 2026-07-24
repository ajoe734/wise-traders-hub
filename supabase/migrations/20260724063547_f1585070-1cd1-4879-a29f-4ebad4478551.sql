
GRANT EXECUTE ON FUNCTION public.ensure_bsr_window(text, int, int) TO anon;

-- 立刻補齊使用者剛剛觀察的 3443
DO $$
DECLARE r jsonb;
BEGIN
  r := public.ensure_bsr_window('3443', 5, 10);
  RAISE NOTICE 'ensure_bsr_window 3443 => %', r::text;
END $$;
