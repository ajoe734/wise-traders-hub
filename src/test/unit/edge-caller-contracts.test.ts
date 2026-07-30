import { describe, expect, it } from 'vitest';
import { auditEdgeContracts } from '../../../scripts/audit-admin-contract.mjs';

describe('edge function caller contracts', () => {
  const violations = auditEdgeContracts();

  it('no edge function constructs its own Supabase client', () => {
    const bad = violations.filter(
      (v) => v.rule === 'no-inline-create-client' || v.rule === 'no-direct-supabase-js-import',
    );
    expect(bad.map((v) => `${v.file} [${v.rule}]`)).toEqual([]);
  });

  it('no edge function hand-rolls a company_admin check', () => {
    const bad = violations.filter(
      (v) => v.rule === 'no-adhoc-has-role-admin' || v.rule === 'no-adhoc-user-roles-admin-query',
    );
    expect(bad.map((v) => `${v.file} [${v.rule}]`)).toEqual([]);
  });
});
