import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface MemberSubExpert {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  role: 'advisor' | 'mentor' | string;
  status: string;
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
  return useQuery({
    queryKey: ['member-subscriptions', user?.id],
    queryFn: async (): Promise<MemberSubscriptionRow[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('member_subscriptions')
        .select('*, expert_plans(*, experts(id, slug, name, avatar_url, role, status))')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (error) throw error;
      return (data || [])
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
            },
            raw: s,
          } as MemberSubscriptionRow;
        })
        .filter((s): s is MemberSubscriptionRow => !!s && s.expert.status === 'active');
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}
