// Insert a conversion row whenever a payment succeeds.
// Reads the user's most recent 30-day first-touch attribution from
// `referral_attributions` (legacy) and `traffic_visits` (new), then derives
// channel and persists into `conversions`.
//
// Designed to be safe to call from edge functions — never throws to the caller.

// Note: SupabaseClient is typed as `any` here to avoid pulling Deno npm:
// types into the project's TS checker (this file is consumed by Deno only).
type SupabaseClient = any;

export interface ConversionInput {
  userId: string;
  orderKind: 'expert_sub' | 'checkup_sub' | 'one_off';
  orderId?: string | null;
  grossAmount: number;
  platformAmount?: number;
  expertAmount?: number;
  attribution?: { visitor_id?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; ref_code?: string; first_touch_at?: string } | null;
}

export async function recordConversion(
  supabase: SupabaseClient,
  input: ConversionInput,
): Promise<void> {
  try {
    // Prefer new traffic_visits (richer); fall back to legacy referral_attributions.
    let visitor_id: string | null = null;
    let utm_source: string | null = null;
    let utm_medium: string | null = null;
    let utm_campaign: string | null = null;
    let utm_content: string | null = null;
    let ref_code: string | null = null;
    let channel = 'direct';
    let referrer_host: string | null = null;
    let first_touch_at: string | null = null;

    const snapshot = input.attribution;
    const { data: tv } = snapshot ? { data: null } : await supabase
      .from('traffic_visits')
      .select('visitor_id, utm_source, utm_medium, utm_campaign, utm_content, ref_code, channel, first_referrer_host, first_seen_at')
      .eq('user_id', input.userId)
      .order('first_seen_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (snapshot) {
      visitor_id = snapshot.visitor_id || null;
      utm_source = snapshot.utm_source || null;
      utm_medium = snapshot.utm_medium || null;
      utm_campaign = snapshot.utm_campaign || null;
      utm_content = snapshot.utm_content || null;
      ref_code = snapshot.ref_code || null;
      first_touch_at = snapshot.first_touch_at || null;
    } else if (tv) {
      visitor_id = tv.visitor_id;
      utm_source = tv.utm_source;
      utm_medium = tv.utm_medium;
      utm_campaign = tv.utm_campaign;
      utm_content = tv.utm_content;
      ref_code = tv.ref_code;
      channel = tv.channel || 'direct';
      referrer_host = tv.first_referrer_host;
      first_touch_at = tv.first_seen_at ?? null;
    } else {
      const { data: ra } = await supabase
        .from('referral_attributions')
        .select('visitor_id, utm_source, utm_medium, utm_campaign, utm_content, ref_code, first_touch_at, created_at')
        .eq('user_id', input.userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (ra) {
        visitor_id = ra.visitor_id;
        utm_source = ra.utm_source;
        utm_medium = ra.utm_medium;
        utm_campaign = ra.utm_campaign;
        utm_content = ra.utm_content;
        ref_code = ra.ref_code;
        first_touch_at = ra.first_touch_at ?? ra.created_at ?? null;
      }
    }

    if (!tv) {
      // Derive channel from utm if we only have legacy data.
      const { data: ch } = await supabase
        .rpc('derive_traffic_channel', {
          _utm_medium: utm_medium,
          _utm_source: utm_source,
          _referrer_host: referrer_host,
        });
      if (typeof ch === 'string') channel = ch;
    }

    // 沒有任何 UTM 的購買一律記為 direct
    if (!utm_source && !utm_medium && !utm_campaign && !utm_content) {
      utm_source = utm_medium = utm_campaign = utm_content = 'direct';
    }

    await supabase.from('conversions').insert({
      user_id: input.userId,
      visitor_id,
      order_kind: input.orderKind,
      order_id: input.orderId ?? null,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      ref_code,
      channel,
      first_touch_at,
      gross_amount: Math.round(input.grossAmount || 0),
      platform_amount: Math.round(input.platformAmount || 0),
      expert_amount: Math.round(input.expertAmount || 0),
    });
  } catch (e) {
    // Telemetry must never break payment flow.
    console.error('[recordConversion] failed:', (e as Error).message);
  }
}
