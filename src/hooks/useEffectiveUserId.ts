import { useAuth } from '@/contexts/AuthContext';
import { useViewAs } from '@/contexts/ViewAsContext';

/**
 * Returns the effective user id to scope member-facing queries by.
 * - When an admin has an active "view-as" session, returns the target user id.
 * - Otherwise returns the real authenticated user id (or null).
 *
 * Important: this MUST NOT be used for mutations. Always gate writes behind
 * `isViewAs === false` (or check `useViewAs().isActive`).
 */
export function useEffectiveUserId(): { userId: string | null; isViewAs: boolean } {
  const { user } = useAuth();
  const { session, isActive } = useViewAs();
  if (isActive && session?.targetUserId) {
    return { userId: session.targetUserId, isViewAs: true };
  }
  return { userId: user?.id ?? null, isViewAs: false };
}
