/**
 * Static contract over the audit + normalization/redaction-v2 migrations
 * for expert_public_samples. Authoritative rules live in the DB; these tests
 * lock the migration text so provenance/privilege can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'supabase/migrations';
const AUDIT = fs.readFileSync(path.join(DIR, '20260821204150_2e682de9-e5ff-4306-b17b-6ec9e1aae850.sql'), 'utf8');
const NORM = fs.readFileSync(path.join(DIR, '20260821204346_163f5904-31fc-4be7-94a5-7c0e3f77399f.sql'), 'utf8');
const NORM_FIX = fs.readFileSync(path.join(DIR, '20260821204614_2edf3be2-4f73-4e30-a19e-3344cbfb5125.sql'), 'utf8');
const CTX = fs.readFileSync(path.join(DIR, '20260821204901_87ecd60a-a5ef-46a9-be7d-0e6d48f93c80.sql'), 'utf8');
const ALL = [AUDIT, NORM, NORM_FIX, CTX].join('\n');

describe('audit columns migration', () => {
  it('adds approval_source with the exact allowed values and default', () => {
    expect(AUDIT).toMatch(/approval_source\s+text\s+NOT NULL\s+DEFAULT\s+'admin_rpc'/);
    expect(AUDIT).toMatch(/approval_source IN \('admin_rpc','owner_directive'\)/);
  });

  it('adds approval_note bounded to 500 chars', () => {
    expect(AUDIT).toMatch(/approval_note\s+text/);
    expect(AUDIT).toMatch(/length\(approval_note\)\s*<=\s*500/);
  });

  it('enforces provenance consistency in both directions', () => {
    expect(AUDIT).toMatch(/approval_source\s*=\s*'admin_rpc'[\s\S]{0,120}approved_by IS NOT NULL/);
    expect(AUDIT).toMatch(/approval_source\s*=\s*'owner_directive'[\s\S]{0,200}approved_by IS NULL/);
    expect(AUDIT).toMatch(/owner_directive[\s\S]{0,220}approval_note/);
  });

  it('approve RPC always stamps admin_rpc + auth.uid()', () => {
    const approve = AUDIT.split('FUNCTION public.approve_expert_public_sample')[1] ?? '';
    expect(approve).toContain("'admin_rpc'");
    expect(approve).toContain('auth.uid()');
    expect(approve).not.toContain("'owner_directive'");
  });

  it('does not create any permanent bypass RPC for owner_directive writes', () => {
    expect(ALL).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.\w*owner_directive\w*/i);
  });

  it('public RPC still hides the audit columns', () => {
    expect(ALL).not.toMatch(/get_expert_public_sample[\s\S]{0,600}approval_(source|note)/);
  });

  it('admin status RPC exposes source/note for auditing', () => {
    const st = AUDIT.split('FUNCTION public.admin_expert_public_sample_status')[1] ?? '';
    expect(st).toContain('approval_source');
    expect(st).toContain('approval_note');
  });

  it('keeps base grants free of anon/authenticated', () => {
    expect(ALL).not.toMatch(/GRANT[^;]*ON public\.expert_public_samples TO[^;]*(anon|authenticated)/);
  });
});

describe('normalization + redaction v2 migration', () => {
  it('normalizer converts block tags to newlines and strips all tags', () => {
    expect(NORM).toContain('CREATE OR REPLACE FUNCTION public.sample_normalize_text');
    expect(NORM).toMatch(/<\\s\*br/);
    expect(NORM).toMatch(/'<\[\^>\]\*>'/);
  });

  it('trims leading/trailing newlines, not just spaces', () => {
    expect(NORM_FIX).toMatch(/btrim\([\s\S]{0,200}E' \\t\\r\\n'\)/);
  });

  it('hashes raw source but stores normalized+redacted text', () => {
    expect(NORM).toMatch(/sha256\(convert_to\(\s*raw/);
    expect(NORM).toContain('sample_normalize_text');
  });

  it('fails closed on html residual', () => {
    expect(CTX).toContain("'html_residual'");
  });

  it('masks thousand separators as a whole token', () => {
    expect(CTX).toMatch(/\[0-9\]\[0-9,\]\*\(\\\.\[0-9\]\+\)\?/);
  });

  it('covers the price-context list with a widened 16-char window', () => {
    for (const kw of ['履約價', '短履約價', '油價', '本金', '最大損失', '目標價', '支撐', '壓力']) {
      expect(CTX).toContain(kw);
    }
    expect(CTX).toContain('[^0-9\\n]{0,16}');
    expect(CTX).toContain('FOR i IN 1..4 LOOP');
  });

  it('keeps years out of the unclassified-numeric gate', () => {
    expect(CTX).toMatch(/\(19\|20\)\[0-9\]\{2\}/);
  });

  it('expands the future-instruction gate', () => {
    for (const kw of ['下周', '下週', '明天', '週五前', '準備', '上攻', '一定要', '建議', '記得']) {
      expect(CTX).toContain(kw);
    }
  });

  it('internal redaction functions stay non-executable by anon/authenticated', () => {
    expect(CTX).toMatch(/REVOKE EXECUTE ON FUNCTION public\.sample_redact_m1\(text\) FROM anon, authenticated;/);
  });

  it('all touched functions pin search_path', () => {
    const defs = ALL.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? [];
    const pins = ALL.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? [];
    expect(defs.length).toBeGreaterThan(0);
    expect(pins.length).toBeGreaterThanOrEqual(defs.length);
  });

  it('does not touch expert_signals RLS/grants/data', () => {
    expect(ALL).not.toMatch(/(ALTER TABLE|GRANT|REVOKE|CREATE POLICY|DROP POLICY|INSERT INTO|UPDATE|DELETE FROM)[^;]*expert_signals/);
  });
});
