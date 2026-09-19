import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExpiringSubscriberRow } from '@/lib/subscriberExpiryReminder';
import { sortExpiring } from '@/lib/subscriberExpiryReminder';

/** 唯一的 server-side RPC 名稱（owner/admin 授權在 DB 內）。 */
export const EXPIRING_SUBSCRIBERS_RPC = 'expiring_subscriptions_for_expert';
/** 「已聯繫」持久化 RPC（owner/admin 授權在 DB 內，非 owner 一律 42501）。 */
export const ACK_SUBSCRIBER_EXPIRY_RPC = 'ack_subscriber_expiry';
export const EXPIRING_SUBSCRIBERS_QUERY_KEY = 'expiring-subscribers';

/**
 * 資料來源 seam：production 走 supabase.rpc；harness／測試可注入 fixture adapter。
 * 排序、query key、staleTime、refetch 行為仍在 hook 內（單一判斷邏輯）。
 * `ack` 是同一個 seam 的寫入端（DB 持久化「已聯繫」），fixture 模式不會碰到 supabase。
 */
export interface ExpiringSubscribersSource {
  rpcName: string;
  ackRpcName?: string;
  fetch: (expertId: string) => Promise<ExpiringSubscriberRow[]>;
  ack?: (subscriptionId: string, expertId: string | null | undefined) => Promise<void>;
}

const productionSource: ExpiringSubscribersSource = {
  rpcName: EXPIRING_SUBSCRIBERS_RPC,
  ackRpcName: ACK_SUBSCRIBER_EXPIRY_RPC,
  fetch: async (expertId) => {
    const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(EXPIRING_SUBSCRIBERS_RPC, { _expert_id: expertId });
    if (error) throw error;
    return (data || []) as ExpiringSubscriberRow[];
  },
  ack: async (subscriptionId) => {
    const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>)(ACK_SUBSCRIBER_EXPIRY_RPC, { _subscription_id: subscriptionId, _ack: true });
    if (error) throw error;
  },
};

export const ExpiringSubscribersSourceContext = createContext<ExpiringSubscribersSource>(productionSource);

/** 元件端取用 seam（含寫入端 ack）。 */
export function useExpiringSubscribersSource(): ExpiringSubscribersSource {
  return useContext(ExpiringSubscribersSourceContext);
}



/**
 * 老師名下 0–7 天內到期的訂閱（server-side ownership：非 owner/admin 會被 RPC 以 42501 拒絕）。
 * 不用 snapshot：每次進頁／視窗聚焦重抓，續訂／取消／改派後立即反映。
 */
export function useExpiringSubscribers(expertId: string | null | undefined, enabled = true) {
  const source = useContext(ExpiringSubscribersSourceContext);
  return useQuery({
    queryKey: [EXPIRING_SUBSCRIBERS_QUERY_KEY, expertId],
    queryFn: async (): Promise<ExpiringSubscriberRow[]> => {
      if (!expertId) return [];
      return sortExpiring(await source.fetch(expertId));
    },
    enabled: !!expertId && enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
