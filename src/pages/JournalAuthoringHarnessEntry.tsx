// @ts-nocheck
/**
 * Preview-only E2E harness that mirrors the exact validation logic used
 * by SignalEditor / SignalCreateDialog at draft → publish time.
 *
 * URL params (all optional):
 *   ac       = tw_stock | us_stock | crypto | us_option | us_future
 *   action   = buy | add | sell | exit | trim | teaching | hold
 *   sym      = symbol (defaults per class)
 *   qty      = quantity (string; may be empty)
 *   price    = entry price
 *   target   = target price (may be "0" — must NOT be swallowed)
 *   capital  = expert starting capital
 *   invQty   = current inventory quantity (for oversell simulation)
 *   invUnit  = current inventory unit
 *   userUnit = raw unit user tried to use (張/股/顆/口/亂填) — sanitizer target
 *
 * Reveals derived state via data-testid so specs can assert:
 *  - resolvedUnit (single source of truth, no 1000× drift)
 *  - notional / capital breach / target price 0 preservation / oversell block
 */
import { useMemo } from 'react';
import { SHARES_PER_LOT } from '@/lib/lotSize';
import {
  getAssetSpec,
  normalizeAssetClass,
  resolveAssetClass,
  sanitizeAssetQuantityUnit,
  isValidAssetSymbol,
} from '@/lib/asset';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

const DEFAULT_SYMBOL: Record<string, string> = {
  tw_stock: '2330',
  us_stock: 'AAPL',
  crypto: 'BTC',
  us_option: 'AAPL240119C00150000',
  us_future: '/ES',
};

// Notional multiplier by unit (mirror handle_signal_trade in DB):
//   張 = SHARES_PER_LOT shares, 股/顆/口 = 1 unit
function notionalOf(qty: number, price: number, unit: string) {
  const mult = unit === '張' ? SHARES_PER_LOT : 1;
  return qty * price * mult;
}

export default function JournalAuthoringHarnessEntry() {
  if (!isPreviewEnv()) return null;

  const params = new URLSearchParams(window.location.search);
  const ac = normalizeAssetClass(params.get('ac') || 'tw_stock');
  const spec = getAssetSpec(ac);
  const action = (params.get('action') || 'buy') as string;
  const sym = (params.get('sym') || DEFAULT_SYMBOL[ac]).trim();
  const qtyRaw = params.get('qty');
  const priceRaw = params.get('price');
  const targetRaw = params.get('target'); // preserve "0" vs null
  const capital = Number(params.get('capital') ?? '10000000');
  const invQty = Number(params.get('invQty') ?? '0');
  const invUnit = sanitizeAssetQuantityUnit(params.get('invUnit'), ac);
  const userUnit = params.get('userUnit') ?? spec.defaultUnit;

  // Derived: single-source-of-truth
  const resolvedUnit = sanitizeAssetQuantityUnit(userUnit, ac);
  const currency = spec.currency;
  const symbolValid = isValidAssetSymbol(sym, ac);

  // Target price 0 preservation: same rule as HoldingsTable input
  const targetParsed = useMemo(() => {
    if (targetRaw === null) return null;
    if (targetRaw === '') return null;
    const n = Number(targetRaw);
    return Number.isFinite(n) ? n : null;
  }, [targetRaw]);

  const qty = qtyRaw === null || qtyRaw === '' ? null : Number(qtyRaw);
  const price = priceRaw === null || priceRaw === '' ? null : Number(priceRaw);

  const notional =
    qty != null && price != null && Number.isFinite(qty) && Number.isFinite(price)
      ? notionalOf(qty, price, resolvedUnit)
      : null;

  const capitalExceeded =
    (action === 'buy' || action === 'add') &&
    notional != null &&
    capital > 0 &&
    notional > capital;

  const isSellSide = action === 'sell' || action === 'trim' || action === 'exit';
  const oversell = isSellSide && qty != null && qty > invQty;
  const unitConflict = isSellSide && invUnit !== resolvedUnit;

  const quantityInvalid = qty !== null && (!Number.isFinite(qty) || qty === 0);
  const priceInvalid =
    !spec.requiresManualPrice &&
    price !== null &&
    (!Number.isFinite(price) || price === 0);

  // For teaching / hold: no trade side-effect, capital + oversell not enforced
  const noSideEffect = action === 'teaching' || action === 'hold';

  const canPublish =
    symbolValid &&
    !quantityInvalid &&
    !priceInvalid &&
    (noSideEffect || (!capitalExceeded && !oversell && !unitConflict));

  const blockReason = noSideEffect
    ? null
    : !symbolValid
    ? 'INVALID_SYMBOL'
    : quantityInvalid
    ? 'QUANTITY_ZERO'
    : priceInvalid
    ? 'PRICE_ZERO'
    : capitalExceeded
    ? 'CAPITAL_EXCEEDED'
    : oversell
    ? 'OVERSELL'
    : unitConflict
    ? 'UNIT_CONFLICT'
    : null;

  return (
    <div
      id="journal-authoring-harness-root"
      style={{ padding: 16, background: '#fff', color: '#111', fontFamily: 'system-ui', width: 520 }}
    >
      <div data-testid="asset-class">{ac}</div>
      <div data-testid="action">{action}</div>
      <div data-testid="symbol">{sym}</div>
      <div data-testid="symbol-valid">{symbolValid ? 'true' : 'false'}</div>
      <div data-testid="user-unit">{userUnit}</div>
      <div data-testid="resolved-unit">{resolvedUnit}</div>
      <div data-testid="currency">{currency}</div>
      <div data-testid="quantity">{qty === null ? 'null' : String(qty)}</div>
      <div data-testid="price">{price === null ? 'null' : String(price)}</div>
      <div data-testid="target-price">{targetParsed === null ? 'null' : String(targetParsed)}</div>
      <div data-testid="target-price-raw">{targetRaw ?? 'null'}</div>
      <div data-testid="notional">{notional === null ? 'null' : String(notional)}</div>
      <div data-testid="capital">{String(capital)}</div>
      <div data-testid="capital-exceeded">{capitalExceeded ? 'true' : 'false'}</div>
      <div data-testid="oversell">{oversell ? 'true' : 'false'}</div>
      <div data-testid="unit-conflict">{unitConflict ? 'true' : 'false'}</div>
      <div data-testid="quantity-invalid">{quantityInvalid ? 'true' : 'false'}</div>
      <div data-testid="price-invalid">{priceInvalid ? 'true' : 'false'}</div>
      <div data-testid="can-publish">{canPublish ? 'true' : 'false'}</div>
      <div data-testid="block-reason">{blockReason ?? 'none'}</div>
    </div>
  );
}
