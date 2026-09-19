/**
 * SECURITY: payment_providers_safe（SECURITY DEFINER view）已移除，
 * 前台一律走 payment_providers_safe_list()（SECURITY DEFINER 函式，只回非敏感欄位）。
 *
 * 靜態合約，防止 drift：
 *  1. 沒有任何 production 程式再讀 payment_providers_safe view
 *  2. 三個 consumer 都走 rpc('payment_providers_safe_list')
 *  3. migration 不得重建 definer view，且必須 REVOKE PUBLIC / GRANT EXECUTE
 *  4. confirm-linepay 的 body 白名單不得放進 simulate / userId / planId / amount
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');

const CONSUMERS = [
  'src/hooks/checkout/useCheckoutData.ts',
  'src/pages/app/AppCheckout.tsx',
  'src/lib/safeViewAccess.ts',
];

describe('payment_providers 安全來源合約', () => {
  for (const f of CONSUMERS) {
    it(`${f} 使用 payment_providers_safe_list() 而非 definer view`, () => {
      const src = read(f);
      expect(src).toContain('payment_providers_safe_list');
      expect(src).not.toMatch(/from\(\s*["']payment_providers_safe["']\s*\)/);
      expect(src).not.toMatch(/from\(\s*["']payment_providers["']\s*\)/);
    });
  }

  it('migration 移除 definer view 並收斂函式權限', () => {
    const sql = read('drizzle/migrations/0003_replace_payment_providers_safe_view_with_definer_function.sql');
    expect(sql).toMatch(/DROP VIEW IF EXISTS public\.payment_providers_safe/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.payment_providers_safe_list/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.payment_providers_safe_list\(\) FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.payment_providers_safe_list\(\) TO anon, authenticated, service_role/i);
    // 底層表不得對 anon 開放
    expect(sql).toMatch(/REVOKE ALL ON public\.payment_providers FROM anon/i);
    expect(sql).not.toMatch(/GRANT[^;]*ON public\.payment_providers TO anon/i);
  });
});

describe('confirm-linepay simulate bypass 不得復活', () => {
  const shared = read('supabase/functions/_shared/linepayConfirm.ts');
  const entry = read('supabase/functions/confirm-linepay/index.ts');

  it('body 白名單只有 orderId / transactionId', () => {
    expect(shared).toMatch(/ALLOWED_CONFIRM_BODY_KEYS\s*=\s*\['orderId',\s*'transactionId'\]/);
  });

  it('不存在任何 simulate 逃生門（僅允許註解說明）', () => {
    const code = shared
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
      .join('\n');
    expect(code).not.toMatch(/simulate/i);
    expect(entry).not.toMatch(/^\s*[^/*].*simulate/im);
  });

  it('entry 不從 client body 取 user / plan / amount', () => {
    expect(entry).not.toMatch(/body\.(userId|planId|amount)/);
  });
});
