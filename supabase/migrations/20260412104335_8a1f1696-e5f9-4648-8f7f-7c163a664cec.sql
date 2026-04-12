-- =============================================
-- 1. checkup_storage: Add user_id + change PK
-- =============================================

-- Add user_id column (nullable temporarily for migration)
ALTER TABLE public.checkup_storage ADD COLUMN user_id uuid;

-- Backfill: assign per-user data to the known user
-- Per-user keys: pf-*, strategy-brain, analysis-history, events, research-history, line-session-*, checkup-upload-count-*
UPDATE public.checkup_storage
SET user_id = 'c97dcc85-1d89-4ecb-b890-0be26dd3df4f'::uuid
WHERE key LIKE 'pf-%'
   OR key LIKE 'line-session-%'
   OR key LIKE 'checkup-upload-count-%'
   OR key LIKE 'research-history%'
   OR key IN ('strategy-brain', 'analysis-history', 'events');

-- System/shared keys get a sentinel UUID
UPDATE public.checkup_storage
SET user_id = '00000000-0000-0000-0000-000000000000'::uuid
WHERE user_id IS NULL;

-- Make NOT NULL
ALTER TABLE public.checkup_storage ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.checkup_storage ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

-- Drop old PK, add composite PK
ALTER TABLE public.checkup_storage DROP CONSTRAINT checkup_storage_pkey;
ALTER TABLE public.checkup_storage ADD PRIMARY KEY (user_id, key);

-- Drop existing RLS policies
DROP POLICY IF EXISTS "Authenticated users can read checkup storage" ON public.checkup_storage;
DROP POLICY IF EXISTS "Authenticated users can insert checkup storage" ON public.checkup_storage;
DROP POLICY IF EXISTS "Authenticated users can update checkup storage" ON public.checkup_storage;

-- New RLS: users can only access their own data
CREATE POLICY "Users can read own checkup storage"
  ON public.checkup_storage FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own checkup storage"
  ON public.checkup_storage FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own checkup storage"
  ON public.checkup_storage FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own checkup storage"
  ON public.checkup_storage FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================
-- 2. checkup_trade_memos: Add user_id
-- =============================================

ALTER TABLE public.checkup_trade_memos ADD COLUMN user_id uuid;

-- Backfill existing data
UPDATE public.checkup_trade_memos
SET user_id = 'c97dcc85-1d89-4ecb-b890-0be26dd3df4f'::uuid
WHERE user_id IS NULL;

-- For future rows, default is not set (must be provided)
ALTER TABLE public.checkup_trade_memos ALTER COLUMN user_id SET NOT NULL;

-- Drop existing RLS policies
DROP POLICY IF EXISTS "Authenticated users can read trade memos" ON public.checkup_trade_memos;
DROP POLICY IF EXISTS "Authenticated users can insert trade memos" ON public.checkup_trade_memos;
DROP POLICY IF EXISTS "Authenticated users can update trade memos" ON public.checkup_trade_memos;
DROP POLICY IF EXISTS "Authenticated users can delete trade memos" ON public.checkup_trade_memos;

-- New RLS: users can only access their own trade memos
CREATE POLICY "Users can read own trade memos"
  ON public.checkup_trade_memos FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own trade memos"
  ON public.checkup_trade_memos FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own trade memos"
  ON public.checkup_trade_memos FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own trade memos"
  ON public.checkup_trade_memos FOR DELETE TO authenticated
  USING (user_id = auth.uid());