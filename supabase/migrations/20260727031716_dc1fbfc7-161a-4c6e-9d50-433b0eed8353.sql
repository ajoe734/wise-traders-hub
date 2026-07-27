-- Grant SELECT to anon so PostgREST returns 200 with empty array (RLS denies all rows).
-- No anon policy exists → default deny → 0 rows, no error.
GRANT SELECT ON public.payment_providers TO anon;