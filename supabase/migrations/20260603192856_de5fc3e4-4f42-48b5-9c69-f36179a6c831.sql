-- E1: drop analyst direct SELECT on member_line_bindings base table
DROP POLICY IF EXISTS "Analysts can view own expert line bindings" ON public.member_line_bindings;

-- E2: remove remittance_orders from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.remittance_orders;