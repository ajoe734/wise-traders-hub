
-- Table for LINE binding verification codes
CREATE TABLE public.line_binding_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Simple unique index on code + used (no now() function)
CREATE UNIQUE INDEX idx_binding_code_active ON public.line_binding_codes (code) WHERE (used = false);

ALTER TABLE public.line_binding_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own binding codes"
ON public.line_binding_codes FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own binding codes"
ON public.line_binding_codes FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Company admins full access binding codes"
ON public.line_binding_codes FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));
