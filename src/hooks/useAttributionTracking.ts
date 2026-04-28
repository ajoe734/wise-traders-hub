import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'lf_attr_v1';
const LOCK_DAYS = 30;

interface AttributionPayload {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  ref_code?: string;
  landing_path?: string;
  visitor_id?: string;
  locked_until: number; // epoch ms
}

function getOrCreateVisitorId(): string {
  let v = localStorage.getItem('lf_visitor_id');
  if (!v) {
    v = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) + '_' + Date.now();
    localStorage.setItem('lf_visitor_id', v);
  }
  return v;
}

export function readAttribution(): AttributionPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AttributionPayload;
    if (parsed.locked_until && parsed.locked_until < Date.now()) {
      // expired
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Capture UTM on landing. First-touch lock for 30 days — new UTM does NOT overwrite.
 */
export function useAttributionTracking() {
  const { user } = useAuth();

  useEffect(() => {
    const url = new URL(window.location.href);
    const sp = url.searchParams;
    const incoming = {
      utm_source: sp.get('utm_source') || undefined,
      utm_medium: sp.get('utm_medium') || undefined,
      utm_campaign: sp.get('utm_campaign') || undefined,
      utm_content: sp.get('utm_content') || undefined,
      ref_code: sp.get('ref') || sp.get('ref_code') || undefined,
    };

    const hasIncoming = Object.values(incoming).some(Boolean);
    const existing = readAttribution();

    let payload: AttributionPayload | null = existing;

    if (hasIncoming && !existing) {
      // First touch — lock for 30 days
      payload = {
        ...incoming,
        landing_path: url.pathname,
        visitor_id: getOrCreateVisitorId(),
        locked_until: Date.now() + LOCK_DAYS * 24 * 60 * 60 * 1000,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

      // Persist to DB (anon allowed via RLS user_id IS NULL)
      supabase.from('referral_attributions').insert({
        user_id: user?.id || null,
        visitor_id: payload.visitor_id || null,
        utm_source: payload.utm_source || null,
        utm_medium: payload.utm_medium || null,
        utm_campaign: payload.utm_campaign || null,
        utm_content: payload.utm_content || null,
        ref_code: payload.ref_code || null,
        landing_path: payload.landing_path || null,
      }).then(() => {});
    }

    // Once user logs in, backfill user_id on most recent attribution row
    if (user?.id && payload && payload.visitor_id) {
      supabase
        .from('referral_attributions')
        .update({ user_id: user.id })
        .eq('visitor_id', payload.visitor_id)
        .is('user_id', null)
        .then(() => {});
    }
  }, [user?.id]);
}
