/**
 * Parse a Postgres error raised by `public.enforce_unit_consistency` into a
 * structured payload for `public.log_unit_lock_violation`.
 *
 * The trigger emits a machine-readable HINT of the form
 *   UNIT_LOCK: expert_id=..., symbol=..., existing_source=..., existing_row_id=...,
 *              existing_unit=..., existing_quantity=..., attempted_unit=...,
 *              allowed_units=..., scope=open_positions_only
 * or, for asset-class mismatch:
 *   ASSET_UNIT_LOCK: expert_id=..., asset_class=..., attempted_unit=..., allowed_units=...
 *
 * Returns null when the error is NOT a unit-lock violation, so callers can
 * skip logging and fall through to their existing generic-error path.
 */
export type UnitLockPayload = {
  kind: 'UNIT_LOCK' | 'ASSET_UNIT_LOCK';
  expert_id?: string;
  symbol?: string;
  existing_source?: string;
  existing_row_id?: string;
  existing_unit?: string;
  existing_quantity?: string;
  attempted_unit?: string;
  asset_class?: string;
  allowed_units?: string;
  scope?: string;
  raw_message: string;
  raw_hint: string;
  raw_code: string;
};

export function parseUnitLockError(err: any): UnitLockPayload | null {
  if (!err) return null;
  const hint = String(err?.hint ?? '');
  const message = String(err?.message ?? '');
  const details = String(err?.details ?? '');
  const combined = `${message} ${details} ${hint}`;

  let kind: UnitLockPayload['kind'] | null = null;
  if (hint.startsWith('UNIT_LOCK:') || combined.includes('UNIT_LOCK:')) {
    kind = 'UNIT_LOCK';
  } else if (hint.startsWith('ASSET_UNIT_LOCK:') || combined.includes('ASSET_UNIT_LOCK:')) {
    kind = 'ASSET_UNIT_LOCK';
  } else {
    return null;
  }

  const body = hint.replace(/^(UNIT_LOCK|ASSET_UNIT_LOCK):\s*/, '');
  const fields: Record<string, string> = {};
  for (const part of body.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) fields[k] = v;
  }

  return {
    kind,
    expert_id: fields.expert_id,
    symbol: fields.symbol,
    existing_source: fields.existing_source,
    existing_row_id: fields.existing_row_id,
    existing_unit: fields.existing_unit,
    existing_quantity: fields.existing_quantity,
    attempted_unit: fields.attempted_unit,
    asset_class: fields.asset_class,
    allowed_units: fields.allowed_units,
    scope: fields.scope,
    raw_message: message,
    raw_hint: hint,
    raw_code: String(err?.code ?? ''),
  };
}
