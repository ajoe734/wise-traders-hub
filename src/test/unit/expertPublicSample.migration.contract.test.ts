/**
 * Static contract over the expert_public_samples migrations.
 * 這些是 provenance / privilege / redaction 的硬合約，任何改動都必須同步更新 receipt。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'supabase/migrations';
const M1 = path.join(DIR, '20260821200916_763b7bba-4e7e-419d-942c-f9aee6b291f2.sql');
const M2 = path.join(DIR, '20260821201014_dd9f1c33-8298-4fcc-9101-8a0e7e328633.sql');
const sql = fs.readFileSync(M1, 'utf8');
const revoke = fs.readFileSync(M2, 'utf8');

describe('expert_public_samples migration contract', () => {
  it('public read RPC projects exactly six columns', () => {
    const block = sql.split('CREATE OR REPLACE FUNCTION public.get_expert_public_sample(_slug text)')[1];
    const cols = block.split('RETURNS TABLE (')[1].split(')')[0]
      .split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
    expect(cols).toEqual(['expert_name', 'expert_slug', 'week_start_taipei', 'sections', 'mask_level', 'updated_at']);
    expect(block).not.toMatch(/raw_text|source_content_hash|approved_by|source_selections/);
  });

  it('every new function is search_path pinned', () => {
    const defs = sql.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(6);
    const occurrences = sql.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(defs.length);
  });

  it('internal functions are not executable by anon/authenticated', () => {
    expect(revoke).toMatch(/REVOKE EXECUTE ON FUNCTION public\.sample_redact_m1\(text\) FROM anon, authenticated;/);
    expect(revoke).toMatch(/REVOKE EXECUTE ON FUNCTION public\.build_expert_public_sample\(uuid, date, jsonb\) FROM anon, authenticated;/);
    for (const fn of ['preview_expert_public_sample', 'approve_expert_public_sample', 'revoke_expert_public_sample', 'admin_expert_public_sample_status']) {
      expect(revoke).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}`);
    }
  });

  it('base table has no anon/authenticated grants', () => {
    expect(sql).not.toMatch(/GRANT[^;]*ON public\.expert_public_samples TO[^;]*(anon|authenticated)/);
    expect(sql).toContain('GRANT ALL ON public.expert_public_samples TO service_role;');
    expect(sql).toContain('ALTER TABLE public.expert_public_samples ENABLE ROW LEVEL SECURITY;');
  });

  it('approve path fetches source server-side (no client text accepted)', () => {
    const approve = sql.split('CREATE OR REPLACE FUNCTION public.approve_expert_public_sample')[1];
    expect(approve).toContain('build_expert_public_sample(_expert_id, _week_start, _selections)');
    expect(approve).not.toMatch(/_sections\b/);
  });

  it('builder enforces provenance guards', () => {
    for (const guard of [
      'not_authorized', 'expert_not_active_mentor', 'week_not_closed', 'bad_selection_keys',
      'bad_source_field', 'duplicate_selection', 'signal_not_found', 'cross_teacher_selection',
      'signal_not_published', 'signal_week_mismatch',
    ]) {
      expect(sql).toContain(guard);
    }
    expect(sql).toMatch(/fld NOT IN \('reason_summary','reason_detail','risk_notes','learning_points','overall_summary'\)/);
  });

  it('redaction fails closed on PII / future instructions / stray numerics', () => {
    for (const reason of ['pii_email', 'pii_phone', 'pii_url_or_line', 'pii_person_name', 'future_instruction', 'unclassified_numeric']) {
      expect(sql).toContain(reason);
    }
    expect(sql).toContain('redaction_gate_failed');
  });

  it('enforces payload limits and single approved sample per expert', () => {
    expect(sql).toMatch(/octet_length\(secs::text\) > 8192/);
    expect(sql).toMatch(/left\(masked, 1200\)/);
    expect(sql).toContain('CREATE UNIQUE INDEX expert_public_samples_one_approved');
  });

  it('does not touch expert_signals RLS or grants', () => {
    expect(sql).not.toMatch(/(ALTER TABLE|CREATE POLICY|DROP POLICY|GRANT|REVOKE)[^;]*expert_signals/);
    expect(revoke).not.toContain('expert_signals');
  });
});
