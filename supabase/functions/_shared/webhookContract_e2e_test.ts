// M-3c-3: End-to-End Auth Contract for webhook-signature edge functions.
//
// Each provider webhook has its own rejection convention (HTTP status is not
// enough — ECPay/ACpay use 200 + a plain-text sentinel body). This test hits
// every deployed webhook with a payload that has NO valid provider signature
// and asserts the response matches the documented rejection contract.
//
// Skip locally with SKIP_AUTH_CONTRACT_E2E=1.
//
// Run:
//   deno test --allow-net --allow-env --allow-read --no-check \
//     supabase/functions/_shared/webhookContract_e2e_test.ts

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { SUPABASE_URL, SUPABASE_ANON_KEY, fnUrl } from './test_utils.ts';

const SKIP = Deno.env.get('SKIP_AUTH_CONTRACT_E2E') === '1';

type Probe = {
  fn: string;
  method?: string;
  headers?: Record<string, string>;
  body: string;
  // Rejection is asserted by: exact status match (if `status` set) AND/OR body
  // regex match (if `bodyMatches` set). At least one must be provided.
  status?: number | number[];
  bodyMatches?: RegExp;
  // Rare: some providers use 200 + sentinel body; the status may legitimately
  // be 200 for a *rejected* request. In that case only bodyMatches is asserted.
  reason: string;
};

const PROBES: Probe[] = [
  {
    fn: 'acpay-notify',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'MerchantID=x&CheckMacValue=bad',
    bodyMatches: /^FAIL/i,
    reason: 'ACpay 一次性金流：MAC 不合 → 純文字 "FAIL"',
  },
  {
    fn: 'acpay-recurring-notify',
    headers: { 'content-type': 'application/json' },
    body: '{"MerchantID":"x","Data":"deadbeef"}',
    bodyMatches: /"err_code"\s*:\s*"1"/,
    reason: 'ACpay 定期定額：解密失敗/欄位缺 → err_code:"1"',
  },
  {
    fn: 'checkup-ecpay-callback',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'MerchantID=x&CheckMacValue=bad',
    bodyMatches: /^0\|/,
    reason: 'ECPay checkup：CheckMacValue 錯誤 → "0|..."',
  },
  {
    fn: 'ecpay-callback',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'MerchantID=x&CheckMacValue=bad',
    bodyMatches: /^0\|/,
    reason: 'ECPay 訂閱：CheckMacValue 錯誤 → "0|..."',
  },
  {
    fn: 'confirm-linepay',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    status: [400, 401, 403],
    reason: 'LINE Pay confirm：缺必填/簽章 → 4xx',
  },
  {
    fn: 'line-webhook',
    headers: { 'content-type': 'application/json' },
    body: '{"events":[]}',
    status: [400, 401, 403],
    reason: 'LINE Messaging webhook：缺 expert_id / X-Line-Signature → 4xx',
  },
];

Deno.test({
  name: 'e2e auth contract — webhook-signature functions reject unsigned requests',
  ignore: SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(SUPABASE_URL && SUPABASE_ANON_KEY, 'missing supabase env');
    const failures: string[] = [];

    await Promise.all(PROBES.map(async (p) => {
      try {
        const res = await fetch(fnUrl(p.fn), {
          method: p.method ?? 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, ...(p.headers ?? {}) },
          body: p.body,
        });
        const text = await res.text();

        if (p.status !== undefined) {
          const allowed = Array.isArray(p.status) ? p.status : [p.status];
          if (!allowed.includes(res.status)) {
            failures.push(`${p.fn}: expected status ${allowed.join('|')}, got ${res.status} (${p.reason})`);
            return;
          }
        }
        if (p.bodyMatches && !p.bodyMatches.test(text)) {
          failures.push(`${p.fn}: body did not match ${p.bodyMatches} — got "${text.slice(0, 120)}" (${p.reason})`);
        }
      } catch (err) {
        failures.push(`${p.fn}: fetch failed — ${(err as Error).message}`);
      }
    }));

    if (failures.length) {
      throw new Error(
        `webhook-class contract violations (${failures.length}/${PROBES.length}):\n  ` +
          failures.join('\n  '),
      );
    }
  },
});
