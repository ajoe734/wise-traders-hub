-- PV catalog fingerprint: every public relation with kind/options/acl/owner.
SELECT c.relname || '|' || c.relkind::text || '|'
       || coalesce(array_to_string(c.reloptions, ','), '-') || '|'
       || coalesce(c.relacl::text, '-') || '|'
       || pg_get_userbyid(c.relowner)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
 ORDER BY 1;
