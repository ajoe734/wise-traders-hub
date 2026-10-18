export interface PlatformSource {
  utm_campaign: string | null;
  utm_content: string | null;
}
export interface PlatformVisit extends PlatformSource { visitor_id: string; first_seen_at: string; is_internal?: boolean }
export interface PlatformReferral extends PlatformSource { user_id: string | null; created_at: string; locked_until: string }
export interface PlatformConversion extends PlatformSource { id: string; gross_amount: number | null; occurred_at: string }
export interface PlatformProfile { user_id: string; created_at: string }
export function platformName(content: string | null): string {
  const value = content?.trim().toLowerCase();
  if (!value) return '未標平台';
  return ({ ig: 'IG', instagram: 'IG', fb: 'FB', facebook: 'FB', yt: 'YouTube', youtube: 'YouTube', line: 'LINE' } as Record<string, string>)[value] ?? content?.trim() ?? '未標平台';
}
export function aggregatePlatforms(visits: PlatformVisit[], referrals: PlatformReferral[], conversions: PlatformConversion[], profiles: PlatformProfile[], campaign: string, from: string, to: string) {
  const inRange = (date: string) => date >= from && date < to;
  const buckets = new Map<string, { platform: string; visitors: Set<string>; signups: Set<string>; orders: Set<string>; gross: number }>();
  const bucket = (row: PlatformSource) => {
    if (row.utm_campaign !== campaign) return null;
    const platform = platformName(row.utm_content);
    let b = buckets.get(platform);
    if (!b) { b = { platform, visitors: new Set(), signups: new Set(), orders: new Set(), gross: 0 }; buckets.set(platform, b); }
    return b;
  };
  for (const row of visits) if (!row.is_internal && inRange(row.first_seen_at)) bucket(row)?.visitors.add(row.visitor_id);
  const first = new Map<string, PlatformReferral>();
  for (const row of [...referrals].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (row.user_id && !first.has(row.user_id)) first.set(row.user_id, row);
  }
  for (const profile of profiles) {
    const source = first.get(profile.user_id);
    if (source && inRange(profile.created_at) && profile.created_at < source.locked_until) bucket(source)?.signups.add(profile.user_id);
  }
  for (const row of conversions) {
    if (!inRange(row.occurred_at)) continue;
    const b = bucket(row);
    if (!b || b.orders.has(row.id)) continue;
    b.orders.add(row.id); b.gross += row.gross_amount ?? 0;
  }
  return [...buckets.values()].map(b => ({ platform: b.platform, visitors: b.visitors.size, signups: b.signups.size, orders: b.orders.size, gross: b.gross })).sort((a, b) => b.visitors - a.visitors || a.platform.localeCompare(b.platform));
}