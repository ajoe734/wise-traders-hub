import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FN_FILE = resolve(__dirname, '../../../supabase/functions/tw-chips-detail/index.ts');
const HOOK_FILE = resolve(__dirname, '../../../src/checkup/lib/chipsRepository.ts');
const MATRIX_FILE = resolve(__dirname, '../../../docs/security/edge-function-auth-matrix.md');
const CONFIG_FILE = resolve(__dirname, '../../../supabase/config.toml');

describe('tw-chips-detail public market-data contract', () => {
  it('Edge Function 必須維持 public，不能要求 caller user session', () => {
    const src = readFileSync(FN_FILE, 'utf8');

    expect(src).toMatch(/\/\/\s*AUTH:\s*public\b/);
    expect(src).not.toMatch(/requireCaller\s*\(/);
    expect(src).not.toMatch(/getCallerUserId\s*\(/);
    expect(src).not.toMatch(/auth\.getUser\s*\(/);
    expect(src).not.toMatch(/Invalid or expired session/);
  });

  it('前端必須固定用 anon JWT 呼叫，不得把 stale user JWT 帶進 chips detail', () => {
    const src = readFileSync(HOOK_FILE, 'utf8');

    expect(src).toMatch(/Authorization:\s*`Bearer \$\{import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY\}`/);
    expect(src).not.toMatch(/auth\.getSession\s*\(/);
    expect(src).not.toMatch(/auth\.refreshSession\s*\(/);
    expect(src).not.toMatch(/auth\.signOut\s*\(/);
  });

  it('Auth matrix 必須標示 tw-chips-detail 為 public', () => {
    const matrix = readFileSync(MATRIX_FILE, 'utf8');
    expect(matrix).toMatch(/\| `tw-chips-detail` \| public \| — \|/);
  });

  it('平台層 JWT 驗證必須關閉，讓公開市場資料 endpoint 可由匿名/demo 使用', () => {
    const config = readFileSync(CONFIG_FILE, 'utf8');
    expect(config).toMatch(/\[functions\.tw-chips-detail\]\s*\nverify_jwt\s*=\s*false/);
  });
});