-- R0-B clone bootstrap: Supabase-equivalent roles/schemas (no PII, no prod data)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  CREATE ROLE authenticator LOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA IF NOT EXISTS auth;
-- pg_net exists in production and is called by the exact statement-level AI
-- reindex trigger. The disposable clone supplies only its side-effect-free API
-- shape: no network call and no trigger is disabled.
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 1000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- ---------------------------------------------------------------------
-- auth.users — PRODUCTION-EXACT shape (R1-P T-P99b).
-- Extracted read-only from the production catalogs (pg_attribute /
-- pg_attrdef / pg_constraint / pg_indexes / pg_class.relacl):
--   35 columns in production ordinal order, production types and defaults,
--   the stored generated column confirmed_at, both CHECK/UNIQUE/PK
--   constraints, all 11 indexes, owner supabase_auth_admin, RLS enabled and
--   the production relacl grantees. No stub columns are invented and none
--   are omitted: the AUTHDEP fingerprint in db/r1/fidelity.sql compares this
--   definition against production on every clone run.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT CREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE dashboard_user NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT supabase_auth_admin, dashboard_user TO postgres;
GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin;

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id                 uuid,
  id                          uuid                        NOT NULL,
  aud                         character varying(255),
  role                        character varying(255),
  email                       character varying(255),
  encrypted_password          character varying(255),
  email_confirmed_at          timestamp with time zone,
  invited_at                  timestamp with time zone,
  confirmation_token          character varying(255),
  confirmation_sent_at        timestamp with time zone,
  recovery_token              character varying(255),
  recovery_sent_at            timestamp with time zone,
  email_change_token_new      character varying(255),
  email_change                character varying(255),
  email_change_sent_at        timestamp with time zone,
  last_sign_in_at             timestamp with time zone,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  is_super_admin              boolean,
  created_at                  timestamp with time zone,
  updated_at                  timestamp with time zone,
  phone                       text                        DEFAULT NULL::character varying,
  phone_confirmed_at          timestamp with time zone,
  phone_change                text                        DEFAULT ''::character varying,
  phone_change_token          character varying(255)      DEFAULT ''::character varying,
  phone_change_sent_at        timestamp with time zone,
  confirmed_at                timestamp with time zone    GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  email_change_token_current  character varying(255)      DEFAULT ''::character varying,
  email_change_confirm_status smallint                    DEFAULT 0,
  banned_until                timestamp with time zone,
  reauthentication_token      character varying(255)      DEFAULT ''::character varying,
  reauthentication_sent_at    timestamp with time zone,
  is_sso_user                 boolean                     NOT NULL DEFAULT false,
  deleted_at                  timestamp with time zone,
  is_anonymous                boolean                     NOT NULL DEFAULT false,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_phone_key UNIQUE (phone),
  CONSTRAINT users_email_change_confirm_status_check
    CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);
CREATE INDEX IF NOT EXISTS users_instance_id_idx ON auth.users USING btree (instance_id);
CREATE INDEX IF NOT EXISTS users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));
CREATE UNIQUE INDEX IF NOT EXISTS confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX IF NOT EXISTS email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX IF NOT EXISTS email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX IF NOT EXISTS reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);
CREATE INDEX IF NOT EXISTS users_is_anonymous_idx ON auth.users USING btree (is_anonymous);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
-- production relacl: supabase_auth_admin=arwdDxtm, dashboard_user=arwdDxtm,
-- postgres=ar*wdDxtm (SELECT WITH GRANT OPTION). anon/authenticated hold none.
GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT ALL ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;
REVOKE ALL ON TABLE auth.users FROM anon, authenticated, service_role;

-- claim shims: byte-equivalent to production auth.uid()/auth.role()/auth.jwt()
-- (extracted read-only from production pg_get_functiondef; real Supabase claims path)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;
