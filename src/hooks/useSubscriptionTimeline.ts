import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TimelineSegment } from '@/components/SubscriptionTimeline';

export interface ExpertTimelineRow {
  expert_id: string;
  expert_name: string;
  expert_slug: string;
  expert_avatar_url: string | null;
  expert_role: string;
  has_active_now: boolean;
  segments: TimelineSegment[] | null;
}

/**
 * 讀取使用者在（指定 / 所有）修煉派老師的訂閱歷史區段。
 *
 * - `userId` 為 null 時停用查詢。
 * - `expertId` 給定時只回傳該老師（供詳情頁）。
 * - 走 RPC `get_user_subscription_timeline`，內建 auth 保護：只能查自己或 admin 可查他人。
 */
export function useSubscriptionTimeline(userId: string | null | undefined, expertId?: string | null) {
  return useQuery({
    queryKey: ['subscription-timeline', userId ?? null, expertId ?? null],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async (): Promise<ExpertTimelineRow[]> => {
      if (!userId) return [];
      const { data, error } = await supabase.rpc('get_user_subscription_timeline', {
        _user_id: userId,
        _expert_id: expertId ?? undefined,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as ExpertTimelineRow[];
    },
  });
}
