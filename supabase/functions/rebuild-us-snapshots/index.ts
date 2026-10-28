// AUTH: company_admin — one-time audited historical reconstruction, no client prices accepted.
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchNasdaqDaily } from '../_shared/nasdaqDaily.ts';
import { completedSessionAt } from '../_shared/usSnapshotRebuild.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try { await requireCompanyAdmin(req); } catch (e) { return authErrorResponse(e, req); }
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.symbols) || !body.symbols.length || body.symbols.length > 5 || body.symbols.some((s: unknown) => typeof s !== 'string' || !/^[A-Z0-9.\-]{1,30}$/.test(s))) return json({ error: '1-5 symbols required' }, 400);
  const supa = serviceClient();
  const results = [];
  for (const symbol of [...new Set<string>(body.symbols)]) {
    try {
      const { data: existing, error } = await supa.from('daily_price_snapshots').select('*').eq('market', 'US').eq('symbol', symbol).eq('is_usable', true).is('source', null).order('trade_date');
      if (error) throw error;
      if (!existing?.length) { results.push({ symbol, already_processed: true }); continue; }
      const from = new Date(`${existing[0].trade_date}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 14);
      const through = existing[existing.length - 1].trade_date;
      const { bars, evidence } = await fetchNasdaqDaily(symbol, from.toISOString().slice(0, 10), through, supa);
      const rebuilt = new Map<string, unknown>();
      let shifted = 0, mismatched = 0, excluded = 0;
      for (const old of existing) {
        const bar = completedSessionAt(old.created_at, bars);
        if (!bar) { excluded++; continue; }
        if (old.trade_date !== bar.trade_date) shifted++;
        if (old.close_price === null || Math.abs(Number(old.close_price) - bar.close_price) > .011) mismatched++;
        rebuilt.set(bar.trade_date, { ...bar, symbol, market: 'US' });
      }
      const rawOriginal = JSON.stringify(existing);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawOriginal))), b => b.toString(16).padStart(2, '0')).join('');
      const { data, error: writeError } = await supa.rpc('rebuild_us_snapshots', { p_original: existing, p_rows: [...rebuilt.values()], p_evidence: { ...evidence, original_sha256: hash, shifted, mismatched, excluded } });
      if (writeError) throw writeError;
      // Preserve raw input and all replacement bars atomically in audit_logs.
      results.push({ symbol, ...data, shifted, mismatched, excluded });
    } catch (e) { results.push({ symbol, error: (e as Error).message }); }
  }
  return json({ results, success: results.every(r => !('error' in r)) });
});