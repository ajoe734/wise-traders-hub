-- P0_HOLDING_DELETE_V1 — 單一持倉刪除的 durable owner-scoped exclusion 模型
-- 狀態：**僅產出檔案，未套用**（不得 apply 到正式 DB）。
-- 帳務隔離：本檔不建立、不修改任何 trade_records / user_performances /
-- starting_capital / cash 相關物件；只新增一張純標記表。

CREATE TABLE IF NOT EXISTS public.checkup_holding_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  excluded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkup_holding_exclusions_symbol_not_blank CHECK (length(btrim(symbol)) > 0),
  CONSTRAINT checkup_holding_exclusions_user_symbol_key UNIQUE (user_id, symbol)
);

-- Data API grants（public schema 無預設權限）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkup_holding_exclusions TO authenticated;
GRANT ALL ON public.checkup_holding_exclusions TO service_role;
REVOKE ALL ON public.checkup_holding_exclusions FROM PUBLIC;
REVOKE ALL ON public.checkup_holding_exclusions FROM anon;

ALTER TABLE public.checkup_holding_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.checkup_holding_exclusions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own rows insert" ON public.checkup_holding_exclusions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows update" ON public.checkup_holding_exclusions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows delete" ON public.checkup_holding_exclusions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS checkup_holding_exclusions_user_idx
  ON public.checkup_holding_exclusions (user_id, excluded_at DESC);
