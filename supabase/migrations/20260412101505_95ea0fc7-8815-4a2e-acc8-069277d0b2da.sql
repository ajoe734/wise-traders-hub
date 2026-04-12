
-- ============================================================
-- 1. Tighten checkup_storage: remove anon access
-- ============================================================
DROP POLICY IF EXISTS "Allow public insert" ON public.checkup_storage;
DROP POLICY IF EXISTS "Allow public read" ON public.checkup_storage;
DROP POLICY IF EXISTS "Allow public update" ON public.checkup_storage;

CREATE POLICY "Authenticated users can read checkup storage"
ON public.checkup_storage
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert checkup storage"
ON public.checkup_storage
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update checkup storage"
ON public.checkup_storage
FOR UPDATE
TO authenticated
USING (true);

-- ============================================================
-- 2. Tighten checkup_trade_memos: remove anon access
-- ============================================================
DROP POLICY IF EXISTS "Allow public delete trade memos" ON public.checkup_trade_memos;
DROP POLICY IF EXISTS "Allow public insert trade memos" ON public.checkup_trade_memos;
DROP POLICY IF EXISTS "Allow public read trade memos" ON public.checkup_trade_memos;
DROP POLICY IF EXISTS "Allow public update trade memos" ON public.checkup_trade_memos;

CREATE POLICY "Authenticated users can read trade memos"
ON public.checkup_trade_memos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert trade memos"
ON public.checkup_trade_memos
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update trade memos"
ON public.checkup_trade_memos
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete trade memos"
ON public.checkup_trade_memos
FOR DELETE
TO authenticated
USING (true);
