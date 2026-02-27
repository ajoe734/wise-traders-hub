
ALTER TABLE public.expert_line_channels ADD COLUMN qr_code_url text;

-- Allow authenticated users to read line_oa_id and qr_code_url (non-sensitive fields)
CREATE POLICY "Authenticated users can view line channel public info"
  ON public.expert_line_channels
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
