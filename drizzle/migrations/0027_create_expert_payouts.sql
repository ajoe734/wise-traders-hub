CREATE TABLE public.expert_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL,
  period_month text NOT NULL CHECK (period_month ~ '^\d{4}-\d{2}$'),
  earnings numeric NOT NULL DEFAULT 0,
  clawback numeric NOT NULL DEFAULT 0,
  carry_in numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  net numeric NOT NULL DEFAULT 0,
  platform_amount numeric NOT NULL DEFAULT 0,
  tx_count integer NOT NULL DEFAULT 0,
  student_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','unmarked')),
  paid_at timestamptz,
  paid_by uuid,
  unmark_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expert_id, period_month)
);
GRANT SELECT, INSERT, UPDATE ON public.expert_payouts TO authenticated;
GRANT ALL ON public.expert_payouts TO service_role;
ALTER TABLE public.expert_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payouts" ON public.expert_payouts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'::app_role));
CREATE POLICY "Admins insert payouts" ON public.expert_payouts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'company_admin'::app_role));
CREATE POLICY "Admins update payouts" ON public.expert_payouts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'company_admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'company_admin'::app_role));