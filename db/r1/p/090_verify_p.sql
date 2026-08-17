-- =====================================================================
-- R1-P 090 VERIFY — replay manifest, 6515 invariant, dual policy,
-- projection swap, T+7 embargo closure, ACL/RLS closure.
-- Requires: db/e0/10_harness.sql, R1 + R1-D + R1-P applied.
-- Every negative asserts SQLSTATE *and* message needle.
-- =====================================================================
\set ON_ERROR_STOP off
SET client_min_messages = warning;
TRUNCATE t.result RESTART IDENTITY;

CREATE SCHEMA IF NOT EXISTS tp;
DROP TABLE IF EXISTS tp.ids;
CREATE TABLE tp.ids(k text primary key, v uuid);
GRANT USAGE ON SCHEMA tp TO anon, authenticated, service_role;
GRANT SELECT ON tp.ids TO anon, authenticated, service_role;
INSERT INTO tp.ids VALUES
 ('userP','aaaaaaa2-0000-4000-8000-0000000000p1'::text::uuid),
 ('expP' ,'bbbbbbb2-0000-4000-8000-000000000001'),
 ('batchP','ccccccc2-0000-4000-8000-000000000001'),
 ('sigE1','ddddddd2-0000-4000-8000-000000000001'),
 ('sigE2','ddddddd2-0000-4000-8000-000000000002'),
 ('sigW1','ddddddd2-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;
