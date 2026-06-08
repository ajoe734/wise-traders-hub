/**
 * W4-4 — Paywall events tracking + A/B variant assignment.
 *
 * 寫入 paywall_events 表（RLS: anon/authenticated 可 INSERT，company_admin 可讀）。
 * Variant 在前端持久化於 localStorage（lf_paywall_variant），50/50 分流。
 * Visitor id 重用 trafficTracker 的 lf_visitor_id。
 */

import { supabase } from '@/integrations/supabase/client';

const VARIANT_KEY = 'lf_paywall_variant';
const VISITOR_KEY = 'lf_visitor_id';

export type PaywallVariant = 'A' | 'B';
export type PaywallKind = 'view' | 'hit_limit' | 'click_upgrade' | 'dismiss';

export function getPaywallVariant(): PaywallVariant {
  try {
    const cached = localStorage.getItem(VARIANT_KEY);
    if (cached === 'A' || cached === 'B') return cached;
    const v: PaywallVariant = Math.random() < 0.5 ? 'A' : 'B';
    localStorage.setItem(VARIANT_KEY, v);
    return v;
  } catch {
    return 'A';
  }
}

function getVisitorId(): string | null {
  try { return localStorage.getItem(VISITOR_KEY); } catch { return null; }
}

// 去重：同 (surface, kind) 在 60 秒內只送一次
const dedupe = new Map<string, number>();
const DEDUPE_MS = 60_000;

export async function trackPaywall(
  kind: PaywallKind,
  surface: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const key = `${surface}|${kind}`;
    const now = Date.now();
    const last = dedupe.get(key) || 0;
    if (now - last < DEDUPE_MS && kind !== 'click_upgrade') return;
    dedupe.set(key, now);

    const variant = getPaywallVariant();
    const visitor_id = getVisitorId();
    const { data: { user } } = await supabase.auth.getUser();

    await supabase.from('paywall_events').insert({
      user_id: user?.id ?? undefined,
      visitor_id: visitor_id ?? undefined,
      event_kind: kind,
      surface,
      variant,
      context: (context ?? null) as never,
    });
  } catch {
    /* swallow — 埋點絕不影響使用者流程 */
  }
}

/** Variant B 文案覆寫表 — 若未來要再加情境直接擴充 */
export const PAYWALL_COPY = {
  A: {
    upgradeBlurbFree: '想立即繼續？升級 Basic（每週 1 次）或 Pro（每月 22 次）',
    upgradeBlurbNone: '收盤分析為訂閱功能，訂閱 Basic（每週 1 次）或 Pro（每月 22 次）即可使用',
    ctaSubscribe: '查看訂閱方案',
    ctaPro: '升級 Pro',
  },
  B: {
    upgradeBlurbFree: '⚡ 限時：升級 Pro 解鎖每月 22 次完整健檢，每天少於 4 元',
    upgradeBlurbNone: '🔓 訂閱解鎖：Basic 每週 1 次 / Pro 每月 22 次，立即開始今日分析',
    ctaSubscribe: '立即解鎖 →',
    ctaPro: '立即升級 Pro →',
  },
} as const;
