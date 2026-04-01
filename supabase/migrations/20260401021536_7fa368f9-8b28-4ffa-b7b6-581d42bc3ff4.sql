CREATE POLICY "Users can select own trade signals"
  ON public.trade_signals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own trade signals"
  ON public.trade_signals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own trade signals"
  ON public.trade_signals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Company admins can select trade signals"
  ON public.trade_signals FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Company admins can insert trade signals"
  ON public.trade_signals FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'company_admin'));

CREATE POLICY "Company admins can update trade signals"
  ON public.trade_signals FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'));