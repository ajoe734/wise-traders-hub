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

/** Only Firstrade (Plaid institution ins_120188) may be linked; verified server-side via /item/get. */
export const FIRSTRADE_INSTITUTION_ID = 'ins_120188';
export function isAllowedInstitution(id: string | null | undefined): boolean {
  return id === FIRSTRADE_INSTITUTION_ID;
}

export interface RevokeConn { id: string; revoke_deadline_at: string; revoke_attempts?: number | null; revoked_at?: string | null }
export interface RevokeDeps {
  getToken(connId: string): Promise<string | null>;
  /** Calls Plaid /item/remove; resolves on success, rejects with { code } on failure. */
  removeItem(token: string): Promise<void>;
  deleteTokenAndDrafts(connId: string): Promise<void>;
  countTokens(connId: string): Promise<number>;
  markPurged(connId: string, revokedAt: string, now: string): Promise<void>;
  markRetry(connId: string, attempts: number, errCode: string | null): Promise<void>;
  alert(urgency: 'near_deadline' | 'overdue', connId: string, deadline: string, errCode: string | null, attempts: number): Promise<void>;
}
export type RevokeResult =
  | { status: 'purged'; late: boolean }
  | { status: 'retry_pending'; error_code: string | null; urgency: RevokeUrgency; attempts: number };

/**
 * One revoke attempt. The token is deleted only after Plaid confirms removal (or reports the item gone);
 * on failure it is kept for the next retry and the attempt is counted; alerts fire near/after the fixed deadline.
 */
export async function attemptRevokeWith(deps: RevokeDeps, conn: RevokeConn, now: Date): Promise<RevokeResult> {
  const tok = await deps.getToken(conn.id);
  let revoked = !tok;
  let errCode: string | null = null;
  if (tok) {
    try { await deps.removeItem(tok); revoked = true; }
    catch (e: any) { errCode = e?.code ?? 'INTERNAL'; revoked = isAlreadyRevoked(errCode ?? undefined); }
  }
  if (revoked) {
    await deps.deleteTokenAndDrafts(conn.id);
    if ((await deps.countTokens(conn.id)) === 0) {
      await deps.markPurged(conn.id, conn.revoked_at ?? now.toISOString(), now.toISOString());
      return { status: 'purged', late: new Date(conn.revoke_deadline_at).getTime() < now.getTime() };
    }
  }
  const attempts = (conn.revoke_attempts || 0) + 1;
  await deps.markRetry(conn.id, attempts, errCode);
  const urgency = revokeUrgency(conn.revoke_deadline_at, now);
  if (urgency !== 'ok') await deps.alert(urgency, conn.id, conn.revoke_deadline_at, errCode, attempts);
  return { status: 'retry_pending', error_code: errCode, urgency, attempts };
}

export interface SyncConn { id: string; status: string; sync_blocked: boolean }
export interface SyncDeps {
  getToken(connId: string): Promise<string | null>;
  fetchHoldings(token: string): Promise<{ holdings?: any[]; securities?: any[] }>;
  /** Locked DB write; must throw an error whose message contains 'plaid_sync_blocked' if disconnected meanwhile. */
  replaceDrafts(connId: string, rows: DraftRow[]): Promise<number>;
  finish(status: 'ok' | 'blocked' | 'failed', extra?: Record<string, unknown>): Promise<void>;
  markFailed(code: string): Promise<void>;
  notifyFailure(code: string): Promise<void>;
}
export type SyncResult = { status: 'ok'; holdings_count: number } | { status: 'blocked' } | { status: 'failed'; error_code: string };

/** One sync run. A disconnect observed before the fetch or at write time is "blocked": no write, no failure notice. */
export async function runSyncWith(deps: SyncDeps, conn: SyncConn): Promise<SyncResult> {
  try {
    if (conn.sync_blocked || conn.status !== 'active') { await deps.finish('blocked'); return { status: 'blocked' }; }
    const tok = await deps.getToken(conn.id);
    if (!tok) throw Object.assign(new Error('TOKEN_MISSING'), { code: 'TOKEN_MISSING' });
    const rows = mapHoldings(await deps.fetchHoldings(tok));
    let n: number;
    try { n = await deps.replaceDrafts(conn.id, rows); }
    catch (e: any) {
      if (String(e?.message || '').includes('plaid_sync_blocked')) { await deps.finish('blocked'); return { status: 'blocked' }; }
      throw e;
    }
    await deps.finish('ok', { holdings_count: n });
    return { status: 'ok', holdings_count: n };
  } catch (e: any) {
    const code = typeof e?.code === 'string' && /^[A-Z_]+$/.test(e.code) ? e.code : 'INTERNAL';
    await deps.finish('failed', { error_code: code });
    await deps.markFailed(code);
    await deps.notifyFailure(code);
    return { status: 'failed', error_code: code };
  }
}
