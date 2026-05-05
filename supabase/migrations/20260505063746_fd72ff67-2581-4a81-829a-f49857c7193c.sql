-- Refresh avatars bucket Storage policies (drop & recreate, idempotent)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can manage any avatar" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can upload any avatar" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can update any avatar" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can delete any avatar" ON storage.objects;
DROP POLICY IF EXISTS "Company admins can read any avatar" ON storage.objects;

-- Public read (bucket is public anyway)
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Owner: first folder = auth.uid()
CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- company_admin can manage any avatar (代分析師上傳/更換)
CREATE POLICY "Company admins can upload any avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND public.has_role(auth.uid(), 'company_admin'::public.app_role)
);

CREATE POLICY "Company admins can update any avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.has_role(auth.uid(), 'company_admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'avatars'
  AND public.has_role(auth.uid(), 'company_admin'::public.app_role)
);

CREATE POLICY "Company admins can delete any avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.has_role(auth.uid(), 'company_admin'::public.app_role)
);