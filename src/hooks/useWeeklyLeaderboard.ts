import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LeaderboardEntry {
  rank: number;
  expertId: string;
  expertSlug: string;
  name: string;
  avatarUrl: string;
  limitUpCount: number;
  winRate: number;
  weeklyReturn: number;
  isHighlighted?: boolean;
}

export function useWeeklyLeaderboard() {
  return useQuery({
    queryKey: ['weekly-limit-up-leaderboard'],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data, error } = await supabase.rpc('get_weekly_limit_up_leaderboard');
      if (error) throw error;
      if (!data || data.length === 0) return [];

      return (data as any[]).map((row, i) => ({
        rank: i + 1,
        expertId: row.expert_id,
        expertSlug: row.expert_slug,
        name: row.expert_name,
        avatarUrl: row.avatar_url || '',
        limitUpCount: Number(row.limit_up_count),
        winRate: Number(row.win_rate),
        weeklyReturn: Number(row.weekly_return),
        isHighlighted: i === 0,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
