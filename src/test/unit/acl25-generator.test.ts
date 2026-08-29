/**
 * R1-P · acl-25 generator regression guard.
 *
 * Why this exists: the 095 verifier was once reported as "70 tests" while the
 * generated file could only ever emit 65 assertions, and the two identity RLS
 * helpers were asserted as "anon closed" — an assertion that contradicted the
 * shipped contract (anon MUST keep EXECUTE on the identity-bound wrapper, or
 * anonymous browsing dies with 42501 inside RLS predicates). A hand-edit or a
 * silent generator drift must never restore either mistake, so the counts and
 * the disposition-specific assertions are pinned here.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const P = join(process.cwd(), 'db/r1/p')
const files = ['095_acl25_verify.sql', 'acl-25.json', 'acl-25.md'] as const
// acl-25.json / .md carry a generated_at stamp; the stable content is everything else
const stable = (p: string) =>
  readFileSync(p, 'utf8').replace(/^.*"?generated(_at)?"?\s*[:=].*$/gim, '')
const sha = (p: string) => createHash('sha256').update(stable(p)).digest('hex')

describe('R1-P acl-25 generator', () => {
  it('regeneration is byte-identical (no hand edits, no drift)', () => {
    // NEVER regenerate in place: the generator stamps generated_at on every run,
    // which would dirty the tracked artifacts on any `vitest run`. Emit to a temp
    // dir and compare the stable content against the tracked blobs instead.
    const out = mkdtempSync(join(tmpdir(), 'acl25-'))
    const before = files.map((f) => sha(join(P, f)))
    execFileSync('python3', [join(P, 'build_acl25.py'), '--check', '--out-dir', out], {
      stdio: 'pipe',
    })
    expect(files.map((f) => sha(join(out, f)))).toEqual(before)
    expect(files.map((f) => sha(join(P, f)))).toEqual(before)
  }, 30_000)


  it('095 pins 64 assertions + coverage (65 executed) — the old "70" is void', () => {
    const sql = readFileSync(join(P, '095_acl25_verify.sql'), 'utf8')
    // 28 unique targets x 2 axes + 2 raw twins + 3 runtime negatives + 3 signature pins
    expect(sql).toContain('v_count, 64)')
    const targets = sql.match(/^\s*\(\d+,\$\$public\./gm) ?? []
    expect(targets.length).toBe(28)
  })

  it('identity RLS helpers are verified as identity-bound wrappers, not "anon closed"', () => {
    const sql = readFileSync(join(P, '095_acl25_verify.sql'), 'utf8')
    expect(sql).toContain("IF r.disposition = 'keep_rls_predicate_helper' THEN")
    expect(sql).toContain('n anon reaches only the identity-bound wrapper')
    expect(sql).toContain('acl_caller_may_read_identity')
    for (const fn of ['has_active_subscription_after', 'is_tester']) {
      expect(sql).toContain(`public.${fn}(`)
    }
    // the ungated twin must still be proven unreachable for anon/authenticated
    expect(sql).toMatch(/_raw'\s*\n\s*LIMIT 1;/)
  })

  it('T-P98i pins the exact identity/visibility signatures (single overload each)', () => {
    const sql = readFileSync(join(P, '095_acl25_verify.sql'), 'utf8')
    for (const fn of ['is_tester', 'has_active_subscription_after', 'signal_is_publicly_visible']) {
      expect(sql).toContain(`$$${fn}$$`)
    }
    expect(sql).toContain('exact signature pinned')
    expect(sql).toContain('v_n = 1 AND v_args = r.args AND v_ret = r.ret')
  })
})
