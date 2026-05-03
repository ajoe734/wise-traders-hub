/**
 * Missing-price client helper
 *
 * Bridges the client-side post-close TWSE sync with the server-side shadow
 * table (`checkup_price_misses`). When the browser-side sync returns
 * `failedCodes`, we ask the `stock-price-sync` edge function (in symbols mode)
 * to retry from the backend, which both attempts a TPEx fallback and logs
 * unresolved codes for support follow-up.
 */
import { supabase } from '@/integrations/supabase/client'

export async function reportMissingSymbols(symbols, { force = true } = {}) {
  const list = Array.from(
    new Set((symbols || []).map((s) => String(s || '').trim()).filter(Boolean))
  )
  if (list.length === 0) return { fetched: 0, missing: [], reasons: {} }
  try {
    const { data, error } = await supabase.functions.invoke('stock-price-sync', {
      body: { symbols: list, force },
    })
    if (error) throw error
    return {
      fetched: data?.fetched || 0,
      missing: data?.missing || [],
      reasons: data?.reasons || {},
    }
  } catch (err) {
    console.warn('[missingPriceClient] report failed:', err?.message || err)
    return { fetched: 0, missing: list, reasons: {}, error: err?.message || String(err) }
  }
}
