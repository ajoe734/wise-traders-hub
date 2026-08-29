/**
 * B4 guard — a plain `vitest run` must NEVER rewrite the tracked ACL artifacts.
 *
 * Root cause this pins: db/r1/p/build_acl25.py used to write acl-25.json,
 * acl-25.md and 095_acl25_verify.sql unconditionally (even with --check), so
 * every full Vitest run stamped a fresh generated_at into tracked files and
 * produced phantom diffs. The generator now honours --out-dir; only the explicit
 * `npm run acl25:generate` command may touch the tracked blobs.
 *
 * This guard does NOT spawn a nested Vitest. It invokes the generator directly.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const P = join(process.cwd(), 'db/r1/p')
const ARTIFACTS = ['acl-25.json', 'acl-25.md', '095_acl25_verify.sql'] as const

const rawSha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
const mtime = (p: string) => statSync(p).mtimeMs
// acl-25.json / .md carry a generated_at stamp; compare everything else
const stable = (p: string) =>
  readFileSync(p, 'utf8').replace(/^.*"?generated(_at)?"?\s*[:=].*$/gim, '')

describe('acl-25 artifacts are never written by a normal test run', () => {
  it('generator --out-dir writes only to temp; tracked sha + mtime unchanged', () => {
    const beforeSha = ARTIFACTS.map((f) => rawSha(join(P, f)))
    const beforeMtime = ARTIFACTS.map((f) => mtime(join(P, f)))

    const out = mkdtempSync(join(tmpdir(), 'acl25-guard-'))
    execFileSync('python3', [join(P, 'build_acl25.py'), '--check', '--out-dir', out], {
      stdio: 'pipe',
    })

    // (a) all three artifacts land in temp and match the tracked stable content
    for (const f of ARTIFACTS) {
      expect(existsSync(join(out, f)), `${f} missing in out-dir`).toBe(true)
      expect(stable(join(out, f)), `${f} content drift`).toBe(stable(join(P, f)))
    }

    // (b) tracked blobs untouched, byte-for-byte, generated_at included
    expect(ARTIFACTS.map((f) => rawSha(join(P, f)))).toEqual(beforeSha)
    expect(ARTIFACTS.map((f) => mtime(join(P, f)))).toEqual(beforeMtime)

    // (c) working tree stays clean for the tracked artifacts
    const diff = execFileSync(
      'git',
      ['diff', '--name-only', '--', ...ARTIFACTS.map((f) => `db/r1/p/${f}`)],
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim()
    expect(diff).toBe('')
  }, 60_000)
})
