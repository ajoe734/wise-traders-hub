import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'lf_attr_v1';
const LOCK_DAYS = 30;
const pendingWrites = new Map<string, Promise<void>>();

async function persistAttribution(userId: string, payload: AttributionPayload): Promise<void> {
  if (!payload.visitor_id) return;
  const key = `${userId}:${payload.visitor_id}:${payload.locked_until}`;
  const pending = pendingWrites.get(key);
  if (pending) return pending;
  const task = (async () => {
    const { data, error } = await supabase.from('referral_attributions')
      .select('id').eq('user_id', userId).eq('visitor_id', payload.visitor_id ?? '')
      .eq('locked_until', new Date(payload.locked_until).toISOString()).limit(1);
    if (error) throw error;
    if (data?.length) return;
    const { error: insertError } = await supabase.from('referral_attributions').insert({
      user_id: userId, visitor_id: payload.visitor_id,
      utm_source: payload.utm_source || null, utm_medium: payload.utm_medium || null,
      utm_campaign: payload.utm_campaign || null, utm_content: payload.utm_content || null,
      ref_code: payload.ref_code || null, landing_path: payload.landing_path || null,
      locked_until: new Date(payload.locked_until).toISOString(),
    });
    if (insertError) throw insertError;
  })();
  pendingWrites.set(key, task);
  try { await task; } finally { pendingWrites.delete(key); }
}

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

    }

    // Anonymous rows do not exist under RLS. Insert the saved first touch on
    // login, retaining its original expiry, rather than updating a missing row.
    const persist = () => {
      const current = readAttribution();
      if (user?.id && current) void persistAttribution(user.id, current).catch(() => {});
    };
    persist();
    window.addEventListener('online', persist);
    return () => window.removeEventListener('online', persist);
  }, [user?.id]);
}
