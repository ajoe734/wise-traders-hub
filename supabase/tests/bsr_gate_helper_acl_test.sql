-- Stage 3B / S3B-0 baseline test — private_bsr gate helper 的 ACL 必須維持封閉
--
-- 本檔是 baseline GREEN（不是 RED）：Stage 1 已經把 private_bsr schema 與 gate helper
-- 建起來，本檔負責在後續 S3B-A/C 的 migration 之後仍然證明「沒有任何前台角色
-- 能直接讀 gate、也沒有任何非 superuser 角色能在 public 建物件」。
-- 之所以要有這一檔：S3B-A 會把七支 producer 改成呼叫 private_bsr.ingest_allowed()，
-- 那些 producer 是 SECURITY DEFINER + search_path=public；只要 anon/authenticated/
-- service_role 任何一個能在 public CREATE，就能綁架名稱解析。
--
-- 隔離協定（v4.1）：整檔包在單一 BEGIN ... ROLLBACK；本檔全程唯讀（只查 catalog），
-- 不建 fixture、不改任何 queue/config/audit row。
--
-- 執行：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_gate_helper_acl_test.sql

\set ON_ERROR_STOP on
BEGIN;

-- 前後 hash 比對用的基準（本檔唯讀，結束時必須完全相同）
\i supabase/tests/_s3b0_snapshot.sql
CALL s3b0_snapshot('before');

-- ─────────────────────────────────────────────
-- Case 1：private_bsr schema 存在，且三個前台角色都沒有 USAGE
-- ─────────────────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private_bsr'),
    'case1: private_bsr schema missing — Stage 1 migration 未套用';

  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    ASSERT NOT has_schema_privilege(r, 'private_bsr', 'USAGE'),
      format('case1: role %s must NOT have USAGE on private_bsr', r);
    ASSERT NOT has_schema_privilege(r, 'private_bsr', 'CREATE'),
      format('case1: role %s must NOT have CREATE on private_bsr', r);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- Case 2：public schema 對非特權角色不得可 CREATE（名稱解析劫持防線）
-- ─────────────────────────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    ASSERT NOT has_schema_privilege(r, 'public', 'CREATE'),
      format('case2: role %s must NOT have CREATE on public — '
             'SECURITY DEFINER producer 使用 search_path=public，可被劫持', r);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- Case 3：gate helper 一律住在 private_bsr，不得有 public 的同名鏡像
-- ─────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('gate_state','gate_classify','ingest_allowed','assert_sanitized');
  ASSERT n = 0,
    format('case3: gate helper 不得暴露在 public schema（found %s）', n);

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'private_bsr' AND p.proname = 'gate_state';
  ASSERT n = 1, format('case3: private_bsr.gate_state() missing (got %s)', n);
END $$;

-- ─────────────────────────────────────────────
-- Case 4：private_bsr 內每一支函式都要固定 search_path，且不得授權給前台角色
-- ─────────────────────────────────────────────
DO $$
DECLARE r record; g text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.proconfig, p.proacl
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'private_bsr'
  LOOP
    ASSERT r.proconfig IS NOT NULL
           AND EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%'),
      format('case4: private_bsr.%s must pin search_path (proconfig=%s)',
             r.proname, r.proconfig);

    FOREACH g IN ARRAY ARRAY['anon','authenticated','service_role','public'] LOOP
      CONTINUE WHEN g <> 'public' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g);
      ASSERT NOT has_function_privilege(g, r.oid, 'EXECUTE'),
        format('case4: %s must NOT have EXECUTE on private_bsr.%s', g, r.proname);
    END LOOP;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- 零殘留驗證：唯讀，前後 queue count / config hash 必須 0 delta
-- ─────────────────────────────────────────────
CALL s3b0_assert_no_residue();

ROLLBACK;
