import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ConfirmationResult {
  success: boolean;
  message?: string;
}

interface Options {
  /** Subscription table to watch — `member_subscriptions` for experts, `checkup_subscriptions` for checkup. */
  table: 'member_subscriptions' | 'checkup_subscriptions';
  /** Auth user id; hook is a no-op until present. */
  userId: string | undefined;
  /** Plan id being purchased; hook is a no-op until present. */
  planId: string | undefined;
  /** When false, the hook stays idle (e.g. waiting for plan data to load). */
  enabled: boolean;
  /** Unique channel suffix to avoid collisions across pages. */
  channelKey: string;
  /** Called with success=true the moment an active subscription appears. */
  onConfirmed: (result: ConfirmationResult) => void;
  /** Toggled while we wait for the callback. */
  setConfirming: (v: boolean) => void;
  /** Optional timeout override (ms). Defaults to 60s. */
  timeoutMs?: number;
  /** Optional polling interval (ms). Defaults to 5s; set to 0 to disable polling. */
  pollMs?: number;
}

/**
 * Watches for an `active` subscription row appearing for {userId, planId}
 * via Realtime + polling fallback. Single source of truth for the 3-way
 * duplicated ECPay/ACpay return handler that previously lived in
 * Checkout.tsx, AppCheckout.tsx and CheckupCheckout.tsx.
 *
 * The caller decides *when* to arm the watcher by flipping `enabled` —
 * typically when `searchParams.get('ecpay') === 'result'` etc.
 */
export function useSubscriptionConfirmation(opts: Options) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!opts.enabled || !opts.userId || !opts.planId || firedRef.current) return;

    let resolved = false;
    opts.setConfirming(true);

    const finish = (result: ConfirmationResult) => {
      if (resolved) return;
      resolved = true;
      firedRef.current = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      supabase.removeChannel(channel);
      opts.setConfirming(false);
      opts.onConfirmed(result);
    };

    const checkExisting = async () => {
      const { data } = await supabase
        .from(opts.table)
        .select('id')
        .eq('user_id', opts.userId!)
        .eq('plan_id', opts.planId!)
        .eq('status', 'active');
      if (data && data.length > 0) finish({ success: true });
    };

    const channel = supabase
      .channel(`${opts.table}-confirm-${opts.channelKey}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: opts.table,
          filter: `user_id=eq.${opts.userId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (row.plan_id === opts.planId && row.status === 'active') {
            finish({ success: true });
          }
        }
      )
      .subscribe();

    const pollInterval = opts.pollMs ?? 5000;
    const pollTimer = pollInterval > 0
      ? setInterval(async () => {
          if (resolved) return;
          const { data } = await supabase
            .from(opts.table)
            .select('id')
            .eq('user_id', opts.userId!)
            .eq('plan_id', opts.planId!)
            .eq('status', 'active');
          if (data && data.length > 0) finish({ success: true });
        }, pollInterval)
      : (undefined as unknown as ReturnType<typeof setInterval>);

    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        finish({ success: false, message: '付款確認逾時，如已扣款請聯繫客服' });
      }
    }, opts.timeoutMs ?? 60_000);

    checkExisting();

    return () => {
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.userId, opts.planId, opts.table, opts.channelKey]);
}
