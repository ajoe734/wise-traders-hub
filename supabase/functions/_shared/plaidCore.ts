// Pure Plaid helpers shared by plaid-link and its tests (no I/O).
export type PlaidEnv = 'sandbox' | 'production';

export function plaidEnv(raw: string | undefined): PlaidEnv {
  // Production stays off until explicitly switched AND approved; anything else is sandbox.
  return raw === 'production' ? 'production' : 'sandbox';
}

export function plaidBaseUrl(env: PlaidEnv): string {
  return env === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
}

export const REVOKE_WINDOW_MS = 24 * 3600 * 1000;
export const REVOKE_ALERT_LEAD_MS = 2 * 3600 * 1000;

/** Deadline is fixed at the first request; retries / duplicate requests never extend it. */
export function revokeDeadline(existing: string | null | undefined, now: Date): string {
  if (existing) return existing;
  return new Date(now.getTime() + REVOKE_WINDOW_MS).toISOString();
}

export type RevokeUrgency = 'ok' | 'near_deadline' | 'overdue';
export function revokeUrgency(deadlineIso: string, now: Date): RevokeUrgency {
  const left = new Date(deadlineIso).getTime() - now.getTime();
  if (left <= 0) return 'overdue';
  if (left <= REVOKE_ALERT_LEAD_MS) return 'near_deadline';
  return 'ok';
}

/** Plaid errors meaning the item is already gone → revocation is effectively complete. */
export function isAlreadyRevoked(errorCode: string | undefined): boolean {
  return errorCode === 'ITEM_NOT_FOUND' || errorCode === 'INVALID_ACCESS_TOKEN';
}

export interface DraftRow {
  security_id: string | null; symbol: string | null; name: string | null; security_type: string | null;
  quantity: number | null; cost_basis: number | null; close_price: number | null; currency: string | null; as_of: string | null;
}

/** Map Plaid /investments/holdings/get into draft rows (cash and zero-qty lines dropped). */
export function mapHoldings(resp: { holdings?: any[]; securities?: any[] }): DraftRow[] {
  const secs = new Map((resp.securities || []).map((s: any) => [s.security_id, s]));
  const out: DraftRow[] = [];
  for (const h of resp.holdings || []) {
    const s: any = secs.get(h.security_id) || {};
    if (s.type === 'cash' || s.is_cash_equivalent) continue;
    const qty = Number(h.quantity);
    if (!Number.isFinite(qty) || qty === 0) continue;
    out.push({
      security_id: h.security_id ?? null,
      symbol: s.ticker_symbol ?? null,
      name: s.name ?? null,
      security_type: s.type ?? null,
      quantity: qty,
      cost_basis: h.cost_basis == null ? null : Number(h.cost_basis),
      close_price: h.institution_price == null ? null : Number(h.institution_price),
      currency: h.iso_currency_code ?? s.iso_currency_code ?? null,
      as_of: h.institution_price_as_of ?? s.close_price_as_of ?? null,
    });
  }
  return out;
}
