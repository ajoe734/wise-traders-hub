import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExpiringSubscriberRow } from '@/lib/subscriberExpiryReminder';
import { sortExpiring } from '@/lib/subscriberExpiryReminder';

/**
 * 老師名下 0–7 天內到期的訂閱（server-side ownership：非 owner/admin 會被 RPC 以 42501 拒絕）。
 * 不用 snapshot：每次進頁／視窗聚焦重抓，續訂／取消／改派後立即反映。
 */
export function useExpiringSubscribers(expertId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['expiring-subscribers', expertId],
    queryFn: async (): Promise<ExpiringSubscriberRow[]> => {
      if (!expertId) return [];
      const { data, error } = await (supabase.rpc as any)('expiring_subscriptions_for_expert', { _expert_id: expertId });
      if (error) throw error;
      return sortExpiring((data || []) as ExpiringSubscriberRow[]);
    },
    enabled: !!expertId && enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
