
-- Storage bucket for rich-text editor (signal/journal) images
INSERT INTO storage.buckets (id, name, public)
VALUES ('signal-media', 'signal-media', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
DROP POLICY IF EXISTS "signal-media public read" ON storage.objects;
CREATE POLICY "signal-media public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'signal-media');

-- Authenticated experts/admins can upload to their own folder (folder = expert_id)
DROP POLICY IF EXISTS "signal-media authed upload" ON storage.objects;
CREATE POLICY "signal-media authed upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'signal-media'
  AND (
    has_role(auth.uid(), 'company_admin'::app_role)
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.experts WHERE user_id = auth.uid()
    )
  )
);

-- Authenticated owners/admins can delete their own files
DROP POLICY IF EXISTS "signal-media authed delete" ON storage.objects;
CREATE POLICY "signal-media authed delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'signal-media'
  AND (
    has_role(auth.uid(), 'company_admin'::app_role)
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.experts WHERE user_id = auth.uid()
    )
  )
);
