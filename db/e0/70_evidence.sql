\pset pager off
\echo === (3a) object owners ===
SELECT c.relkind, n.nspname||'.'||c.relname AS object, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','app_ledger') AND c.relkind IN ('r','S','v')
 ORDER BY 1,2;

\echo === (3b) type + function owners / security / search_path ===
SELECT n.nspname||'.'||t.typname AS type, pg_get_userbyid(t.typowner) AS owner
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname IN ('public','app_ledger') AND t.typtype='e' ORDER BY 1;

SELECT n.nspname||'.'||p.proname AS function, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer, coalesce(p.proconfig::text,'(none)') AS proconfig,
       coalesce(p.proacl::text,'(default: PUBLIC EXECUTE)') AS execute_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','app_ledger') ORDER BY 1;

\echo === (3c) table + column privileges for the economic surface ===
SELECT r.rolname AS grantee, x.tbl,
       has_table_privilege(r.rolname, x.tbl, 'SELECT') AS sel,
       has_table_privilege(r.rolname, x.tbl, 'INSERT') AS ins,
       has_table_privilege(r.rolname, x.tbl, 'UPDATE') AS upd,
       has_table_privilege(r.rolname, x.tbl, 'DELETE') AS del
  FROM (VALUES ('app_ledger.economic_effect'),('app_ledger.effect_projection_mutation'),
               ('app_ledger.portfolio_cash_ledger'),('app_ledger.effect_review_event'),
               ('public.trade_records'),('public.public_position_projection'),
               ('public.public_position_active')) x(tbl),
       (VALUES ('anon'),('authenticated'),('service_role'),('ledger_owner')) r(rolname)
 ORDER BY x.tbl, r.rolname;

SELECT r.rolname AS grantee, c.col,
       has_column_privilege(r.rolname,'public.trade_records',c.col,'UPDATE') AS can_update
  FROM (VALUES ('current_price'),('price_updated_at'),('quantity'),('entry_price'),
               ('exit_price'),('status'),('signal_id'),('last_event_id'),
               ('last_projection_mutation_id')) c(col),
       (VALUES ('anon'),('authenticated'),('service_role')) r(rolname)
 ORDER BY c.col, r.rolname;

\echo === (3d) schema usage ===
SELECT r.rolname, s.nsp, has_schema_privilege(r.rolname, s.nsp, 'USAGE') AS usage
  FROM (VALUES ('app_ledger'),('public')) s(nsp),
       (VALUES ('anon'),('authenticated'),('service_role'),('ledger_owner')) r(rolname)
 ORDER BY s.nsp, r.rolname;

\echo === (4a) deterministic structural hashes ===
SELECT 'schema_columns' AS artifact, md5(string_agg(x, E'\n' ORDER BY x)) AS sha
  FROM (SELECT table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-') x
          FROM information_schema.columns
         WHERE table_schema IN ('public','app_ledger')) s
UNION ALL
SELECT 'constraints', md5(string_agg(x, E'\n' ORDER BY x))
  FROM (SELECT n.nspname||'.'||c.relname||'.'||con.conname||':'||pg_get_constraintdef(con.oid) x
          FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname IN ('public','app_ledger')) s
UNION ALL
SELECT 'triggers', md5(string_agg(x, E'\n' ORDER BY x))
  FROM (SELECT n.nspname||'.'||c.relname||'.'||tg.tgname||':'||pg_get_triggerdef(tg.oid) x
          FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE NOT tg.tgisinternal AND n.nspname IN ('public','app_ledger')) s
UNION ALL
SELECT 'functions', md5(string_agg(x, E'\n' ORDER BY x))
  FROM (SELECT n.nspname||'.'||p.proname||':'||md5(pg_get_functiondef(p.oid)) x
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('public','app_ledger')) s
UNION ALL
SELECT 'grants', md5(string_agg(x, E'\n' ORDER BY x))
  FROM (SELECT grantee||':'||table_schema||'.'||table_name||':'||privilege_type x
          FROM information_schema.role_table_grants
         WHERE table_schema IN ('public','app_ledger')) s
UNION ALL
SELECT 'function_acl', md5(string_agg(x, E'\n' ORDER BY x))
  FROM (SELECT n.nspname||'.'||p.proname||':'||coalesce(p.proacl::text,'DEFAULT') x
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('public','app_ledger')) s;

\echo === (4b) structural invariants required by the plan ===
SELECT 'mutation.target_row_id NOT NULL for all ops' AS invariant,
       (SELECT is_nullable='NO' FROM information_schema.columns
         WHERE table_schema='app_ledger' AND table_name='effect_projection_mutation'
           AND column_name='target_row_id') AS holds
UNION ALL
SELECT 'unique (event_id, mutation_seq)',
  EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
           WHERE c.relname='effect_projection_mutation' AND con.contype IN ('u','p')
             AND pg_get_constraintdef(con.oid) LIKE '%(event_id, mutation_seq)%')
UNION ALL
SELECT 'multi-step hash chain on one row (before_hash of step N+1 = after_hash of step N)',
  (SELECT bool_and(ok) FROM (
     SELECT m.before_hash IS NOT DISTINCT FROM lag(m.after_hash) OVER
              (PARTITION BY m.target_row_id ORDER BY m.mutation_seq) AS ok
       FROM app_ledger.effect_projection_mutation m
      WHERE m.event_id IN (SELECT event_id FROM app_ledger.effect_projection_mutation
                            GROUP BY event_id HAVING count(*) FILTER
                              (WHERE target_table='trade_records') > 1)) q
   WHERE ok IS NOT NULL)
UNION ALL
SELECT 'economic_effect append-only over full payload (UPDATE+DELETE trigger)',
  EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
           WHERE c.relname='economic_effect' AND NOT tg.tgisinternal
             AND pg_get_triggerdef(tg.oid) LIKE '%BEFORE UPDATE OR DELETE%')
UNION ALL
SELECT 'per-expert active pointer (PK on expert_id)',
  EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
           WHERE c.relname='public_projection_active' AND con.contype='p'
             AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (expert_id)')
UNION ALL
SELECT 'active views join on expert_id AND version',
  (SELECT bool_and(pg_get_viewdef(c.oid) LIKE '%expert_id%' AND
                   pg_get_viewdef(c.oid) LIKE '%active_version%')
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v'
      AND c.relname IN ('public_position_active','public_portfolio_active','public_nav_active'));

\echo === (2) test ledger: counts and every negative case ===
SELECT kind, count(*) total, count(*) FILTER (WHERE passed) passed FROM t.result GROUP BY 1;
SELECT name, expected_sqlstate, actual_sqlstate, expected_needle, passed
  FROM t.result WHERE kind='negative' ORDER BY name;
SELECT count(*) AS failures FROM t.result WHERE NOT passed;
