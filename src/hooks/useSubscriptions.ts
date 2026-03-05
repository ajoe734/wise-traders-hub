import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useMySubscriptions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-subscriptions', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('member_subscriptions')
        .select('*, expert_plans(*, experts(*))')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (error) throw error;
      return (data || []).filter((sub: any) => {
        const expert = sub.expert_plans?.experts;
        return expert && expert.status === 'active';
      });
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useSubscribedExpertSlugs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['subscribed-slugs', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from('member_subscriptions')
        .select('plan_id, expert_plans(expert_id, experts(slug))')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (!data) return [];
      return data
        .filter((sub: any) => sub.expert_plans?.experts?.status === 'active')
        .map((sub: any) => sub.expert_plans?.experts?.slug)
        .filter(Boolean) as string[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}
