-- 確保 current_prices 完整 row 會被 broadcast
ALTER TABLE public.current_prices REPLICA IDENTITY FULL;

-- 加入 realtime publication（用 DO block 避免重覆加入時噴錯）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'current_prices'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.current_prices';
  END IF;
END $$;