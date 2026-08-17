-- R1-D: return the clone's DATA to the empty post-schema baseline so the
-- rollback hash can be compared against the pre-R1-D hash. Structure only is
-- restored by 099_rollback.sql + clone/functions.sql; this file removes the
-- rows that the test suites inserted.
DO $$
DECLARE r record; stmt text := '';
BEGIN
  SET session_replication_role = replica;   -- suppress FK/trigger noise while purging
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind='r' AND n.nspname IN ('public','auth')
  LOOP stmt := stmt || format('%I.%I,', r.nspname, r.relname); END LOOP;
  IF stmt <> '' THEN
    EXECUTE 'TRUNCATE TABLE ' || rtrim(stmt, ',') || ' RESTART IDENTITY CASCADE';
  END IF;
  SET session_replication_role = origin;
END $$;
