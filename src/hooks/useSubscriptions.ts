import { useMemo } from 'react';
import { useMemberSubscriptions } from './useMemberSubscriptions';

export function useMySubscriptions() {
  const { data = [], isLoading, error } = useMemberSubscriptions();
  // Return raw subscription rows (kept for back-compat with old shape: row + expert_plans nested)
  const subscriptions = useMemo(() => data.map((s) => s.raw), [data]);
  return { data: subscriptions, isLoading, error };
}

export function useSubscribedExpertSlugs() {
  const { data = [], isLoading, error } = useMemberSubscriptions();
  const slugs = useMemo(
    () => Array.from(new Set(data.map((s) => s.expert.slug).filter(Boolean))) as string[],
    [data],
  );
  return { data: slugs, isLoading, error };
}
