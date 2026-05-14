## Root cause: every `/app/*` page pays a layout-wide tax on every navigation

`UnifiedAppLayout` wraps every `/app/*` route. On every navigation it re-runs an effect that fires **3 sequential Supabase queries** (and re-renders nav from scratch):

```ts
// src/components/layouts/UnifiedAppLayout.tsx:169-237
useEffect(() => {
  if (!user) return;
  loadUnreadCounts();        // 1) member_subscriptions  (with experts join)
                             // 2) expert_signals HEAD count (advisor)
                             // 3) expert_signals HEAD count (mentor)
}, [user, location.pathname]);   // ← refetches on every page change
```

On top of that:

- **`member_subscriptions` is queried 4× across the app** with different query keys, so react-query can't dedupe:
  - `UnifiedAppLayout.loadUnreadCounts` (raw effect, no cache)
  - `useSubscribedExpertSlugs` (Explore)
  - `useMySubscriptions` (`fetchMemberSubscriptions`)
  - `AppHome.fetchHomeData`
- **`AppHome` opens N Supabase Realtime channels** — `ExpertPerfRow` calls `useExpertPerformance(expertId)`, which `supabase.channel('expert-perf-${id}').subscribe()` per row. With 5 subs that's 5 WebSocket subscriptions + 5 RPC calls just to render avatars.
- **Two `expert_signals` HEAD count queries** in the layout effect — one of these is the request that shows up as `ERR_ABORTED` in the network log on `/expert/sharkgu`.
- `NotificationBell` uses local state instead of react-query, so it can't share cache with anything else.

The Explore page itself (`useExperts` + `useSubscribedExpertSlugs`, both 30 s `staleTime`) is fine — its slowness is the layout overhead above, not the page body.

## Goal
Make navigation between `/app/*` pages effectively instant after the first load by removing redundant network work and capping realtime sockets.

## Changes

### 1. Single source of truth for `member_subscriptions`
Create `src/hooks/useMemberSubscriptions.ts`:

```text
export function useMemberSubscriptions() {
  // one query, rich shape with expert_plans(*, experts(id, slug, name, avatar_url, role, status))
  // queryKey: ['member-subscriptions', user.id], staleTime: 60_000
}
```

Refactor consumers to read from it (selecting only what they need):
- `src/hooks/useSubscriptions.ts` — `useSubscribedExpertSlugs`, `useMySubscriptions`
- `src/pages/app/AppHome.tsx` — `fetchHomeData` becomes a pure derive over the hook's data
- `src/components/layouts/UnifiedAppLayout.tsx` — derives `hasAdvisor` / `hasMentor` / `advisorExpertIds` / `mentorExpertIds` from the same hook (no separate query)

### 2. Stop re-fetching unread counts on every navigation
In `UnifiedAppLayout`, replace the raw `useEffect([user, location.pathname])` with two react-query queries:

```text
useQuery({
  queryKey: ['unread-signals', user.id, advisorExpertIds],
  queryFn: HEAD count expert_signals where expert_id IN (advisor) AND published_at > lastSeen,
  enabled: advisorExpertIds.length > 0,
  staleTime: 60_000,
})
// ditto for journals (mentor)
```

`location.pathname` is removed from the dependency set entirely. The mark-as-read helpers (`markAppSignalsAsRead` / `markAppJournalsAsRead`) already exist; have them call `queryClient.invalidateQueries(['unread-signals', …])` so the badge clears immediately.

### 3. Stop opening one realtime channel per subscribed expert on the home screen
In `src/hooks/usePerformance.ts::useExpertPerformance`:
- Remove the per-expert `supabase.channel('expert-perf-${expertId}')` subscription.
- The 5-minute cron that updates `user_performances` does not need realtime invalidation on the home rows — `staleTime: 60_000` plus react-query's `refetchOnWindowFocus` is enough.
- For the expert detail page where realtime *is* desirable, keep the subscription scoped to that page only (or move it into `useExpertPerformanceRealtime(expertId)` opt-in hook used by detail pages).

This change also fixes the WebSocket churn that compounds latency when navigating in/out of the home page.

### 4. Convert `NotificationBell` to react-query
- Replace local `useState` + `fetchNotifications()` effect with `useQuery({ queryKey: ['notifications', user.id], staleTime: 60_000 })`.
- `markAllRead` / `handleClick` mutate via `useMutation` with `setQueryData` for optimistic updates.
- Allows the bell to share data with any future notifications page and avoids a re-fetch on every layout mount.

### 5. Drop the duplicate fetch path in `fetchHomeData`
After step 1, `AppHome` no longer needs its own `fetchHomeData` query — it derives `advisorSubs` / `mentorSubs` synchronously from `useMemberSubscriptions()`.

## Files to change
- `src/hooks/useMemberSubscriptions.ts` (new)
- `src/hooks/useSubscriptions.ts`
- `src/hooks/usePerformance.ts`
- `src/components/layouts/UnifiedAppLayout.tsx`
- `src/components/NotificationBell.tsx`
- `src/pages/app/AppHome.tsx`

## Out of scope (separate follow-ups if needed)
- Company admin pages (`/company/*`) also have their own `member_subscriptions` queries — they're admin-only and not part of the user's reported pain.
- `Checkout.tsx` realtime listeners are intentional (waiting for ACpay callback) — leave alone.
- `ExpertProfile.tsx` was already deduped in the previous turn.

## Verification
- After the change, navigating between `/app`, `/app/explore`, `/app/signals`, `/app/journals`, `/app/account` should issue **zero** new Supabase requests on each navigation (verified via the network panel) once the initial caches are warm.
- `/app` should open **at most one** Supabase Realtime channel, regardless of how many subscriptions the user has.
- Unread badges still update within 60 s and immediately after `markAppSignalsAsRead` / `markAppJournalsAsRead` is called.