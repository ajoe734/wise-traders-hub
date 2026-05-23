import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UserIdentity = {
  user_id: string;
  display_name: string | null;
  email: string;
  line_user_id: string | null;
  login_method: 'email' | 'line';
};

export function useUserIdentities(userIds: string[]) {
  const sortedKey = useMemo(
    () => Array.from(new Set(userIds.filter(Boolean))).sort().join(','),
    [userIds],
  );

  const query = useQuery({
    queryKey: ['user-identities', sortedKey],
    enabled: sortedKey.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const ids = sortedKey.split(',').filter(Boolean);
      const { data, error } = await supabase.functions.invoke('admin-manage-users', {
        body: { action: 'lookup_identities', user_ids: ids },
      });
      if (error) throw error;
      const map: Record<string, UserIdentity> = {};
      ((data as any)?.identities || []).forEach((i: UserIdentity) => {
        map[i.user_id] = i;
      });
      return map;
    },
  });

  return {
    identities: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function formatIdentitySecondary(id: UserIdentity | undefined, userId: string): string {
  const tail = userId.slice(0, 8);
  if (!id) return tail;
  if (id.login_method === 'line') {
    const lineTail = id.line_user_id ? id.line_user_id.slice(-6) : '';
    return [lineTail && `Line ${lineTail}`, tail].filter(Boolean).join(' · ');
  }
  return [id.email, tail].filter(Boolean).join(' · ');
}
