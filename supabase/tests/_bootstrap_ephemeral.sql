-- Build 1d — ephemeral cluster bootstrap（僅供 /tmp 臨時 cluster 使用）
--
-- 目的：讓 supabase/migrations/*.sql 的「原文」可以 408/408 直接套用，
-- 不需要任何 sed / stub / 跳檔。
--
-- 沿用 .github/workflows/finmind-admit-sql-tests.yml 已驗證的 bootstrap 策略：
--   1) auth schema + 最小 auth.users + auth.uid()
--   2) anon / authenticated / service_role 三個 role
-- 額外只做一件事：先建立 migrations 會用到的三個擴充，
--   因為 migrations 皆使用 `CREATE EXTENSION IF NOT EXISTS ...`，
--   擴充已存在時該語句是 no-op（連 WITH SCHEMA 都不再檢查），
--   所以 migration 原文完全不需修改。

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;   -- control: schema=pg_catalog, relocatable=false
CREATE EXTENSION IF NOT EXISTS pg_net;

-- pgcrypto 裝在 extensions，但 migrations 直接呼叫 gen_random_uuid()（PG13+ 內建）與 digest 等，
-- 保險起見把 extensions 放進預設 search_path。
ALTER DATABASE bsr_ephemeral SET search_path TO public, extensions;

-- 最小 auth stub（與 CI 相同）
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

-- storage stub（少數 migration 對 storage.objects / storage.buckets 建 policy）
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;

-- 三大 role（RLS policies 引用）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;
