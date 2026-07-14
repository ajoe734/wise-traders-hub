
-- journal-exports bucket: 只有 company_admin 可以直接讀寫（Edge Function 用 service role 不受限）
CREATE POLICY "Company admins read journal exports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'journal-exports' AND public.has_role(auth.uid(), 'company_admin'::public.app_role));

CREATE POLICY "Company admins insert journal exports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'journal-exports' AND public.has_role(auth.uid(), 'company_admin'::public.app_role));

CREATE POLICY "Company admins delete journal exports"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'journal-exports' AND public.has_role(auth.uid(), 'company_admin'::public.app_role));
