/**
 * Static contract over the service-bootstrap guard delta for build_expert_public_sample.
 *
 * 硬合約：
 * - 授權判斷不得使用 current_user（在 SECURITY DEFINER 內等於 function owner，
 *   任何誤獲 EXECUTE 的 caller 都會通過 → definer trap）。
 * - 只允許兩條路徑：company_admin（auth.uid() + has_role）或可驗證的 service bootstrap
 *   （session_user = postgres/supabase_admin 直連，或 authenticator + JWT role=service_role）。
 * - build / helper 對 anon / authenticated 一律 REVOKE EXECUTE。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'supabase/migrations';
const GUARD_A = path.join(DIR, '20260821210520_8d7048c2-837a-4004-adb4-2cff088e2344.sql');
const GUARD_B = path.join(DIR, '20260821210741_b30f87d0-858e-44d5-8403-dc3d031814b3.sql');
const a = fs.readFileSync(GUARD_A, 'utf8');
const b = fs.readFileSync(GUARD_B, 'utf8');
const all = `${a}\n${b}`;
const stripComments = (s: string) => s.replace(/^\s*--.*$/gm, '');
const buildBlock = a.split('CREATE OR REPLACE FUNCTION public.build_expert_public_sample')[1];

describe('build_expert_public_sample service bootstrap guard', () => {
  it('never uses current_user for authorization (definer trap)', () => {
    expect(stripComments(all)).not.toMatch(/current_user/);
  });

  it('service path is decided by session_user + verified JWT claim only', () => {
    expect(b).toMatch(/su text := session_user::text/);
    expect(b).toMatch(/IF su IN \('postgres', 'supabase_admin'\) THEN\s+RETURN true;/);
    expect(b).toMatch(/IF su <> 'authenticator' THEN\s+RETURN false;/);
    expect(b).toMatch(/current_setting\('request\.jwt\.claims', true\)/);
    expect(b).toMatch(/RETURN jrole = 'service_role';/);
  });

  it('admin path still requires auth.uid() + company_admin', () => {
    expect(a).toMatch(
      /auth\.uid\(\) IS NOT NULL\s+AND public\.has_role\(auth\.uid\(\), 'company_admin'::public\.app_role\)/,
    );
    expect(a).toContain("RAISE EXCEPTION 'not_authorized'");
  });

  it('guard is the disjunction of exactly those two paths', () => {
    const guard = buildBlock.split('BEGIN')[1].split("RAISE EXCEPTION 'not_authorized'")[0];
    expect(guard).toContain('public.sample_caller_is_service_bootstrap()');
    expect(guard).toContain('public.has_role(auth.uid()');
    expect(guard).not.toMatch(/session_user|current_user/);
  });

  it('anon/authenticated keep zero EXECUTE on builder and helper', () => {
    for (const sig of [
      'public.build_expert_public_sample(uuid, date, jsonb)',
      'public.sample_caller_is_service_bootstrap()',
    ]) {
      expect(all).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
      expect(all).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM authenticated;`);
      expect(all).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
      expect(all).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    }
  });

  it('helper is SECURITY INVOKER and search_path pinned', () => {
    expect(b).toMatch(/SECURITY INVOKER/);
    expect(b).toMatch(/SET search_path TO 'pg_catalog', 'public', 'pg_temp'/);
  });

  it('guard delta does not touch expert_signals or other features', () => {
    expect(all).not.toMatch(/ALTER TABLE public\.expert_signals/);
    expect(all).not.toMatch(/ON public\.expert_signals TO/);
    expect(all).not.toMatch(/CREATE POLICY/);
    expect(all).not.toMatch(/DROP\s+(TABLE|POLICY)/i);
    // no data writes in a schema migration
    expect(all).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.expert_public_samples/);
  });

  it('builder body is otherwise unchanged (all provenance guards retained)', () => {
    for (const guard of [
      'expert_not_active_mentor', 'week_not_closed', 'bad_selections', 'bad_selection_count',
      'bad_selection_keys', 'bad_source_field', 'bad_signal_id', 'duplicate_selection',
      'signal_not_found', 'cross_teacher_selection', 'signal_not_published', 'signal_week_mismatch',
    ]) {
      expect(a).toContain(guard);
    }
    expect(a).toContain('public.sample_redact_m1(public.sample_normalize_text(raw))');
  });
});
