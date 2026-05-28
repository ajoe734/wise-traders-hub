// Insert a conversion row whenever a payment succeeds.
// Reads the user's most recent 30-day first-touch attribution from
// `referral_attributions` (legacy) and `traffic_visits` (new), then derives
// channel and persists into `conversions`.
//
// Designed to be safe to call from edge functions — never throws to the caller.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ConversionInput {
  userId: string;
  orderKind: 'expert_sub' | 'checkup_sub' | 'one_off';
  orderId?: string | null;
  grossAmount: number;
  platformAmount?: number;
  expertAmount?: number;
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

    const { data: tv } = await supabase
      .from('traffic_visits')
      .select('visitor_id, utm_source, utm_medium, utm_campaign, utm_content, ref_code, channel, first_referrer_host')
      .eq('user_id', input.userId)
      .order('first_seen_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (tv) {
      visitor_id = tv.visitor_id;
      utm_source = tv.utm_source;
      utm_medium = tv.utm_medium;
      utm_campaign = tv.utm_campaign;
      utm_content = tv.utm_content;
      ref_code = tv.ref_code;
      channel = tv.channel || 'direct';
      referrer_host = tv.first_referrer_host;
    } else {
      const { data: ra } = await supabase
        .from('referral_attributions')
        .select('visitor_id, utm_source, utm_medium, utm_campaign, utm_content, ref_code')
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
      gross_amount: Math.round(input.grossAmount || 0),
      platform_amount: Math.round(input.platformAmount || 0),
      expert_amount: Math.round(input.expertAmount || 0),
    });
  } catch (e) {
    // Telemetry must never break payment flow.
    console.error('[recordConversion] failed:', (e as Error).message);
  }
}
