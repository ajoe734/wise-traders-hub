-- ============================================================
-- 1. line_login_nonces: explicit deny-all to satisfy linter.
--    service_role bypasses RLS, so the exchange edge function is unaffected.
-- ============================================================
CREATE POLICY "Deny direct access to line_login_nonces"
  ON public.line_login_nonces
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- 2. Storage: drop overly broad public-listing policies.
--    Public buckets still serve files via /storage/v1/object/public/...
--    Removing SELECT on storage.objects only blocks enumeration via the LIST API.
--    No code path in the project calls `.list()` (verified via ripgrep).
-- ============================================================

-- avatars: two duplicate broad-read policies → drop both
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public can view avatars"               ON storage.objects;

-- signal-media: broad public read → drop
DROP POLICY IF EXISTS "signal-media public read" ON storage.objects;

-- (Ownership-based update/delete and admin upload policies are intentionally kept.)