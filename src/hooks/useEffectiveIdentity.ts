import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useViewAs } from '@/contexts/ViewAsContext';

export interface EffectiveIdentity {
  id: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isLineUser: boolean;
  isTester: boolean;
  isViewAs: boolean;
}

/**
 * 會員頁要「顯示」的身分。視角檢視時回傳被檢視會員（唯讀），否則回傳登入者。
 * 只能用於顯示與讀取，寫入一律以 isViewAs 擋下。
 */
export function useEffectiveIdentity(): EffectiveIdentity {
  const { user } = useAuth();
  const { session, isActive } = useViewAs();
  const targetId = isActive ? session?.targetUserId ?? null : null;

  const { data: prof } = useQuery({
    queryKey: ['view-as-identity', targetId],
    enabled: !!targetId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('profiles')
        .select('display_name, avatar_url, is_tester').eq('user_id', targetId!).maybeSingle();
      return data as { display_name: string | null; avatar_url: string | null; is_tester: boolean | null } | null;
    },
  });

  if (targetId) {
    const email = session?.targetEmail ?? null;
    return {
      id: targetId,
      email,
      displayName: prof?.display_name ?? session?.targetDisplayName ?? null,
      avatarUrl: prof?.avatar_url ?? null,
      isLineUser: !!email && email.endsWith('@line.local'),
      isTester: !!prof?.is_tester,
      isViewAs: true,
    };
  }
  return {
    id: user?.id ?? null,
    email: user?.email ?? null,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    isLineUser: !!user?.isLineUser,
    isTester: !!user?.isTester,
    isViewAs: false,
  };
}
