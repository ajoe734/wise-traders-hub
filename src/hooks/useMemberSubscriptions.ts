import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';

export interface MemberSubExpert {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  role: 'advisor' | 'mentor' | string;
  status: string;
  line_oa_id: string | null;
  line_channel_name: string | null;
  qr_code_url: string | null;
}

export interface MemberSubscriptionRow {
  plan_id: string;
  plan_type: string;
  expert_id: string;
  expert: MemberSubExpert;
  raw: any;
}

/**
 * Single source of truth for the current user's active member_subscriptions.
 * All other consumers (UnifiedAppLayout, AppHome, useSubscribedExpertSlugs,
 * useMySubscriptions) should derive from this query so react-query can dedupe.
 */
export function useMemberSubscriptions() {
  const { user } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  return useQuery({
    queryKey: ['member-subscriptions', effectiveUserId, isViewAs],
    queryFn: async (): Promise<MemberSubscriptionRow[]> => {
      if (!effectiveUserId) return [];
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('member_subscriptions')
        .select('*, expert_plans(*, experts(id, slug, name, avatar_url, role, status, line_oa_id, line_channel_name, qr_code_url))')
        .eq('user_id', effectiveUserId)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (error) throw error;
      const rows = (data || [])
        .map((s: any) => {
          const ep = s.expert_plans;
          const e = ep?.experts;
          if (!ep || !e) return null;
          return {
            plan_id: s.plan_id,
            plan_type: ep.plan_type || '',
            expert_id: ep.expert_id || e.id,
            expert: {
              id: e.id,
              slug: e.slug,
              name: e.name,
              avatar_url: e.avatar_url ?? null,
              role: e.role,
              status: e.status || 'active',
              line_oa_id: e.line_oa_id ?? null,
              line_channel_name: e.line_channel_name ?? null,
              qr_code_url: e.qr_code_url ?? null,
            },
            raw: s,
          } as MemberSubscriptionRow;
        })
        .filter((s): s is MemberSubscriptionRow => !!s && s.expert.status === 'active');

      // Dedupe by expert.id: after account-merge the same user can end up with multiple
      // active subs pointing at the same expert (different plan_id). UI shows the row
      // with the latest expires_at as the single effective subscription.
      const byExpert = new Map<string, MemberSubscriptionRow>();
      for (const r of rows) {
        const prev = byExpert.get(r.expert.id);
        if (!prev) { byExpert.set(r.expert.id, r); continue; }
        const prevX = prev.raw?.expires_at ? new Date(prev.raw.expires_at).getTime() : 0;
        const curX = r.raw?.expires_at ? new Date(r.raw.expires_at).getTime() : 0;
        if (curX > prevX) byExpert.set(r.expert.id, r);
      }
      return Array.from(byExpert.values());
    },
    enabled: !!effectiveUserId && (!!user || isViewAs),
    staleTime: 60_000,
  });
}
