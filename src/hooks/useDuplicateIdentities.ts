import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { describeFunctionFailure, formatFailure } from '@/lib/functionError';
import {
  findDuplicateIdentityClusters,
  indexClustersByUser,
  type AccountRow,
  type DuplicateCluster,
} from '@/lib/duplicateIdentity';

/**
 * 後台唯讀：找出「同一人疑似有兩個帳號、但只有其中一個有訂閱」的群集。
 * 帳號母體沿用既有的 admin-manage-users `list`（company_admin 限定）。
 */
export function useDuplicateIdentities(subscribedUserIds: string[]) {
  const subsKey = useMemo(
    () => Array.from(new Set(subscribedUserIds.filter(Boolean))).sort().join(','),
    [subscribedUserIds],
  );

  const accountsQuery = useQuery({
    queryKey: ['company', 'duplicate-identities', 'accounts'],
    staleTime: 60_000,
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase.functions.invoke('admin-manage-users', {
        body: { action: 'list', limit: 200 },
      });
      const failure = await describeFunctionFailure(data, error, '使用者清單讀取失敗');
      if (failure) throw new Error(formatFailure(failure, '使用者清單讀取失敗'));
      return ((data as any)?.users || []).map((u: any) => ({
        user_id: u.user_id,
        email: u.email || '',
        display_name: u.display_name ?? null,
        is_line: !!u.is_line,
        line_user_id: u.line_user_id ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
      }));
    },
  });

  const clusters: DuplicateCluster[] = useMemo(() => {
    if (!accountsQuery.data) return [];
    return findDuplicateIdentityClusters(accountsQuery.data, subsKey.split(',').filter(Boolean));
  }, [accountsQuery.data, subsKey]);

  const byUser = useMemo(() => indexClustersByUser(clusters), [clusters]);

  return { clusters, byUser, isLoading: accountsQuery.isLoading, error: accountsQuery.error };
}
