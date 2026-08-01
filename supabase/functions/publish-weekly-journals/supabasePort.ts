/**
 * Supabase + LINE adapter for PublishPort（真實外部世界那一側）。
 */
import { serviceClient } from '../_shared/supabaseClients.ts';
import { buildNotificationRow } from '../_shared/routes.ts';
import type {
  ActiveSubscription, ExpertRow, LineBinding, LineChannel,
  MulticastResult, NotificationRow, PendingSignal, PublishPort,
} from './port.ts';

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';

const PENDING_COLUMNS =
  'id, expert_id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, teaching_topic, overall_summary, published_at, batch_id, executed_at';

export function createSupabasePublishPort(
  admin: ReturnType<typeof serviceClient> = serviceClient(),
): PublishPort {
  return {
    async listExperts() {
      const { data } = await admin.from('experts').select('id, asset_class');
      return (data || []) as ExpertRow[];
    },
    async listExpertsByIds(ids: string[]) {
      const { data } = await admin.from('experts').select('id, user_id, name').in('id', ids);
      return (data || []) as ExpertRow[];
    },
    async getExpert(id: string) {
      const { data } = await admin
        .from('experts').select('id, user_id, name, slug').eq('id', id).maybeSingle();
      return (data || null) as ExpertRow | null;
    },

    async listPendingSignals(expertIds: string[] | null) {
      let q = admin.from('expert_signals').select(PENDING_COLUMNS).eq('status', 'pending');
      if (expertIds) q = q.in('expert_id', expertIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as PendingSignal[];
    },
    async markSignalPublished(signalId: string, market: string) {
      const { error } = await admin
        .from('expert_signals').update({
          status: 'published',
          market,
          published_at: new Date().toISOString(),
        }).eq('id', signalId);
      if (error) throw error;
    },
    async logUnitLockViolation(payload: Record<string, unknown>) {
      const { error } = await admin.rpc('log_unit_lock_violation', { payload });
      if (error) throw error;
    },
    async insertNotifications(rows: NotificationRow[]) {
      if (rows.length === 0) return;
      // 最後一道防線：link 一律走 _shared/routes.ts builder，任何硬寫的 404 路徑在此擋下
      const safeRows = rows.map((r) =>
        buildNotificationRow({
          userId: r.user_id, title: r.title, body: r.body, type: r.type, link: r.link,
        })
      );
      const { error } = await admin.from('notifications').insert(safeRows as any);
      if (error) throw error;
    },

    async closeOpenTradeSignal(userId: string, symbol: string) {
      await admin.from('trade_signals')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('user_id', userId).eq('symbol', symbol).eq('status', 'open');
    },
    async deleteUserPerformance(userId: string, symbol: string) {
      await admin.from('user_performances').delete().eq('user_id', userId).eq('symbol', symbol);
    },
    async hasOpenTradeRecords(expertId: string, stockCode: string) {
      const { data } = await admin.from('trade_records').select('id')
        .eq('expert_id', expertId).ilike('instrument', `${stockCode}%`).eq('status', 'open').limit(1);
      return !!(data && data.length > 0);
    },
    async hasOpenTradeSignal(userId: string, symbol: string) {
      const { data } = await admin.from('trade_signals').select('id')
        .eq('user_id', userId).eq('symbol', symbol).eq('status', 'open').limit(1);
      return !!(data && data.length > 0);
    },
    async openTradeSignalWithPerformance({ userId, symbol, name, entryPrice }) {
      const { data: tsData } = await admin.from('trade_signals')
        .insert({ user_id: userId, symbol, name, entry_price: entryPrice, status: 'open' })
        .select('id').single();
      if (!tsData) return;
      await admin.from('user_performances').insert({
        user_id: userId,
        signal_id: (tsData as any).id,
        symbol,
        name,
        entry_price: entryPrice,
        current_price: entryPrice,
        pnl: 0,
        pnl_percent: 0,
      });
    },

    async getLineChannel(expertId: string) {
      const { data } = await admin.from('expert_line_channels')
        .select('channel_access_token, is_active').eq('expert_id', expertId).maybeSingle();
      return (data || null) as LineChannel | null;
    },
    async listActiveBindings(expertId: string) {
      const { data } = await admin.from('member_line_bindings')
        .select('line_user_id, user_id').eq('expert_id', expertId).eq('is_active', true);
      return (data || []) as LineBinding[];
    },
    async listActiveSubscriptions(userIds: string[]) {
      if (userIds.length === 0) return [];
      const { data } = await admin.from('member_subscriptions')
        .select('user_id, plan_id, canceled_at, expires_at')
        .in('user_id', userIds).eq('status', 'active').gt('expires_at', new Date().toISOString());
      return (data || []) as ActiveSubscription[];
    },
    async listExpertPlanIds(expertId: string) {
      const { data } = await admin.from('expert_plans').select('id').eq('expert_id', expertId);
      return (data || []).map((p: any) => p.id as string);
    },
    async calcExpertPerformance(expertId: string) {
      const { data } = await admin.rpc('calculate_expert_performance', { _expert_id: expertId });
      return data;
    },
    async sendLineMulticast(token: string, to: string[], messages: unknown[]): Promise<MulticastResult> {
      const res = await fetch(LINE_MULTICAST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ to, messages }),
      });
      if (res.ok) { await res.text(); return { ok: true, status: res.status }; }
      return { ok: false, status: res.status, body: await res.text() };
    },

    async claimPushRecipients({ dedupeKey, kind, expertId, recipients }) {
      if (recipients.length === 0) return [];
      const rows = recipients.map((recipient) => ({
        dedupe_key: dedupeKey, recipient, kind, expert_id: expertId,
      }));
      const { data, error } = await admin
        .from('line_push_receipts')
        .upsert(rows as any, { onConflict: 'dedupe_key,recipient', ignoreDuplicates: true })
        .select('recipient');
      if (error) throw error;
      return (data || []).map((r: any) => r.recipient as string);
    },
    async releasePushClaims(dedupeKey: string, recipients: string[]) {
      if (recipients.length === 0) return;
      await admin.from('line_push_receipts')
        .delete().eq('dedupe_key', dedupeKey).in('recipient', recipients);
    },


    now: () => new Date(),
  };
}
