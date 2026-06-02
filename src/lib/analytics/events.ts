/**
 * Centralized analytics event schema (GA4 / PostHog / Mixpanel style).
 *
 * Naming convention: `object_action` snake_case.
 * All events get base props injected automatically (page_path, user_role,
 * is_internal). Custom props go in `event_props`.
 *
 * Adding an event? Add it to `AnalyticsEvent` below — TypeScript will
 * enforce required props at call sites.
 */

import { trackEvent as rawTrack } from '@/lib/trafficTracker';

// ---- Event taxonomy ----------------------------------------------------
export type AnalyticsEvent =
  // Public pages
  | { name: 'home_view'; props?: Record<string, unknown> }
  | { name: 'home_section_view'; props: { section: string } }
  | { name: 'home_cta_click'; props: { cta: string; section?: string } }
  | { name: 'experts_list_view'; props?: Record<string, unknown> }
  | { name: 'expert_card_click'; props: { expert_slug: string } }
  | { name: 'expert_profile_view'; props: { expert_slug: string } }
  | { name: 'leaderboard_view'; props?: { source?: string } }
  | { name: 'leaderboard_card_click'; props: { instrument: string; expert_slug?: string } }
  | { name: 'pricing_view'; props?: Record<string, unknown> }
  // Checkup (修煉派)
  | { name: 'checkup_view'; props?: { tab?: string } }
  | { name: 'checkup_tab_change'; props: { tab: string } }
  | { name: 'checkup_holding_expand'; props: { code: string } }
  | { name: 'checkup_holding_target_update'; props: { code: string } }
  | { name: 'checkup_holding_alert_update'; props: { code: string } }
  | { name: 'checkup_holdings_sort_change'; props: { sort_by: string } }
  | { name: 'checkup_demo_click'; props?: Record<string, unknown> }
  | { name: 'checkup_analysis_run'; props?: { kind?: string } }
  | { name: 'checkup_quota_blocked'; props?: { reason?: string } }
  | { name: 'checkup_upgrade_click'; props?: { from?: string } }
  // App / 跟單派
  | { name: 'app_dashboard_view'; props?: Record<string, unknown> }
  | { name: 'signal_view'; props: { instrument: string; signal_id?: string } }
  | { name: 'signal_card_click'; props: { instrument: string; signal_id?: string } }
  | { name: 'holdings_dashboard_view'; props?: { holdings_count?: number } }
  | { name: 'holding_card_click'; props: { instrument: string; pnl_bucket?: string } }
  | { name: 'journal_view'; props?: { expert_slug?: string } }
  | { name: 'journal_card_click'; props: { journal_id: string; expert_slug?: string } }
  | { name: 'subscribed_experts_view'; props?: Record<string, unknown> }
  | { name: 'expert_detail_view'; props: { expert_slug: string } }
  // Checkout funnel
  | { name: 'expert_subscribe_click'; props: { expert_slug: string; plan_id?: string } }
  | { name: 'checkout_open'; props: { plan_id?: string; expert_slug?: string } }
  | { name: 'checkout_consent_accept'; props?: { plan_id?: string } }
  | { name: 'checkout_payment_method_select'; props: { method: string } }
  | { name: 'checkout_submit'; props: { plan_id?: string; method?: string } }
  | { name: 'checkout_success'; props?: { plan_id?: string; amount?: number } }
  | { name: 'checkout_failure'; props: { reason: string; plan_id?: string } }
  | { name: 'subscription_cancel_click'; props?: { plan_id?: string } }
  | { name: 'subscription_renew_click'; props?: { plan_id?: string } }
  // Learning
  | { name: 'learning_view'; props?: Record<string, unknown> }
  | { name: 'system_detail_view'; props: { system_id: string } }
  | { name: 'learning_card_click'; props: { item_id: string } }
  // Account / notifications
  | { name: 'notifications_open'; props?: Record<string, unknown> }
  | { name: 'notification_click'; props: { notification_id: string } }
  | { name: 'profile_view'; props?: Record<string, unknown> }
  | { name: 'line_binding_start'; props?: { expert_slug?: string } }
  | { name: 'line_binding_success'; props?: { expert_slug?: string } }
  // Internal (is_internal=true auto-set by route)
  | { name: 'admin_page_view'; props?: { page?: string } }
  | { name: 'signal_publish'; props?: { instrument?: string } }
  | { name: 'signal_recall'; props?: { signal_id?: string } }
  | { name: 'journal_publish'; props?: Record<string, unknown> }
  | { name: 'mentor_dashboard_view'; props?: Record<string, unknown> }
  | { name: 'company_page_view'; props?: { page?: string } }
  // Generic page_view (auto-fired by router listener)
  | { name: 'page_view'; props?: { path?: string; from?: string } };

/** Type-safe wrapper around the raw tracker. */
export function track<E extends AnalyticsEvent>(name: E['name'], props?: E['props']) {
  rawTrack(name, props as Record<string, unknown> | undefined);
}

/** Convenience: subset for non-typed callers (legacy code). */
export function trackRaw(name: string, props?: Record<string, unknown>) {
  rawTrack(name, props);
}
