
-- 1. expert_line_channels: 每位分析師的 LINE OA 設定
CREATE TABLE public.expert_line_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL UNIQUE REFERENCES public.experts(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  channel_access_token text NOT NULL,
  channel_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_line_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins full access line channels"
  ON public.expert_line_channels FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

CREATE TRIGGER update_expert_line_channels_updated_at
  BEFORE UPDATE ON public.expert_line_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. member_line_bindings: 訂閱者的 LINE 綁定
CREATE TABLE public.member_line_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  line_user_id text NOT NULL,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  bound_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expert_id)
);

ALTER TABLE public.member_line_bindings ENABLE ROW LEVEL SECURITY;

-- Users can view own bindings
CREATE POLICY "Users can view own line bindings"
  ON public.member_line_bindings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert own bindings
CREATE POLICY "Users can insert own line bindings"
  ON public.member_line_bindings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update own bindings
CREATE POLICY "Users can update own line bindings"
  ON public.member_line_bindings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Company admins full access
CREATE POLICY "Company admins full access line bindings"
  ON public.member_line_bindings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- Analysts can view bindings for their expert
CREATE POLICY "Analysts can view own expert line bindings"
  ON public.member_line_bindings FOR SELECT
  TO authenticated
  USING (expert_id IN (
    SELECT id FROM public.experts WHERE user_id = auth.uid()
  ));
