/**
 * 合約測試：所有 app email 一律走 supabase/functions/_shared/mailer.ts。
 *
 * 事故背景：9 個發信功能各自直連外部寄信服務 Resend，金鑰失效（401）後
 * 全站 Email 同時停擺。改用平台內建郵件後，禁止任何函式再直呼外部寄信 API。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FN_ROOT = 'supabase/functions';

function allFunctionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...allFunctionSources(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const SOURCES = allFunctionSources(FN_ROOT).map((p) => ({ path: p, src: readFileSync(p, 'utf8') }));

// 期望寄信的功能（改造範圍）
const MAIL_SENDERS = [
  'email-push-renewal-reminder',
  'subscriber-expiry-teacher-reminder',
  'notify-payment-failure',
  'recover-abandoned-checkout',
  'recover-failed-transactions',
  'checkup-notify-complete',
  'notify-backtest-result',
  'knowledge-full-audit',
  'admin-manage-users',
];

describe('app email 單一資料源', () => {
  it('Edge Function 不得再出現外部寄信服務金鑰或端點', () => {
    const offenders = SOURCES.filter(
      ({ src }) => src.includes('RESEND_API_KEY') || src.includes('api.resend.com'),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('_shared/mailer.ts 是唯一發信入口', () => {
    const mailer = readFileSync(`${FN_ROOT}/_shared/mailer.ts`, 'utf8');
    expect(mailer).toContain('sendLovableEmail');
    expect(mailer).toContain('notify.legendflow.tw');
  });

  it('9 個發信功能都從 mailer 發信', () => {
    for (const fn of MAIL_SENDERS) {
      const src = readFileSync(`${FN_ROOT}/${fn}/index.ts`, 'utf8');
      expect(src, fn).toContain("_shared/mailer.ts");
      expect(src, fn).toContain('sendAppEmail');
    }
  });
});
