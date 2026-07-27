/**
 * Route B live smoke — cleanup helper.
 *
 * 呼叫 e2e-simulate-purchase edge function 的 `action: 'cleanup'`，
 * 由 test 的 afterAll 觸發。清掉本輪 simulated 訂閱 / 交易 / funnel 事件。
 *
 * Cleanup 依賴：
 *   - E2E_ALLOW_SIMULATED_PURCHASE=1（edge function env）
 *   - 呼叫者為 tester (profiles.is_tester=true)
 */
import type { Page } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const PUB_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/** Ask the browser to grab the current Supabase access token from localStorage. */
export async function readAccessToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    for (const k of keys) {
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { access_token?: string };
        if (parsed?.access_token) return parsed.access_token;
      } catch { /* noop */ }
    }
    return null;
  });
}

async function callSimulate(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/e2e-simulate-purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: PUB_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

export interface SimulatePurchaseResult {
  ok: boolean;
  subscriptionId?: string;
  transactionId?: string;
  providerTxId?: string;
  planId?: string;
  amount?: number;
}

export async function simulatePurchase(page: Page, planId?: string): Promise<SimulatePurchaseResult> {
  const token = await readAccessToken(page);
  if (!token) throw new Error('simulatePurchase: no supabase access token in localStorage');
  const { status, json } = await callSimulate(token, {
    action: 'purchase',
    planId,
    visitor_id: `e2e-live-${Date.now()}`,
  });
  if (status !== 200 || !json || typeof json !== 'object') {
    throw new Error(`simulatePurchase failed: status=${status} body=${JSON.stringify(json)}`);
  }
  return json as SimulatePurchaseResult;
}

export async function cleanupSimulated(page: Page): Promise<{ transactions: number; subscriptions: number; events: number }> {
  const token = await readAccessToken(page);
  if (!token) return { transactions: 0, subscriptions: 0, events: 0 };
  const { status, json } = await callSimulate(token, { action: 'cleanup' });
  if (status !== 200 || !json || typeof json !== 'object') {
    // 清理失敗不擋 CI，但要噴 warning，靠 daily cron log 追
    // eslint-disable-next-line no-console
    console.warn(`[e2e cleanup] failed status=${status} body=${JSON.stringify(json)}`);
    return { transactions: 0, subscriptions: 0, events: 0 };
  }
  return (json as { deleted: { transactions: number; subscriptions: number; events: number } }).deleted;
}
