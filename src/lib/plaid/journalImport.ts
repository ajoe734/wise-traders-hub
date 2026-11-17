// Pure rules for bringing teacher-confirmed Plaid holding snapshots into the existing journal editor.
// A snapshot is NOT a trade: it never sets an action, price or date; it only pre-fills symbol / name /
// the quantity gap against the existing ledger (useExpertHoldingsBundle open positions).
import { isValidAssetSymbol, type AssetClass } from '@/lib/asset';
import { emptyTrade, type OpenPosition, type TradeDraft } from '@/pages/_signalEditor/types';

export interface ConfirmedSnapshotRow {
  connection_id: string;
  symbol: string | null;
  name: string | null;
  security_type: string | null;
  quantity: number | null;
  as_of: string | null;
  review_status: string;
}

export type ImportStatus =
  | 'new'            // broker holds it, ledger has none
  | 'diff'           // both hold it, quantities differ
  | 'match'          // ledger already equals broker snapshot → nothing to import
  | 'ledger_only'    // ledger holds it, broker snapshot does not → info only, never invent an exit
  | 'in_editor'      // already brought into (or typed in) the current editor
  | 'unsupported';   // symbol/security type/market the journal ledger cannot record

export interface ImportCandidate {
  key: string;
  symbol: string;
  name: string;
  snapshotQty: number;
  ledgerQty: number;
  /** snapshot − ledger (positive = ledger is short). */
  gap: number;
  status: ImportStatus;
  reason?: string;
}

const SUPPORTED_TYPES = new Set(['equity', 'etf']);
const norm = (s: string | null | undefined) => (s || '').trim().toUpperCase();
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function sourceKey(connectionId: string, symbol: string, asOf: string | null) {
  return `plaid:${connectionId}:${norm(symbol)}:${asOf || ''}`;
}

export function buildImportCandidates(
  snapshot: ConfirmedSnapshotRow[],
  ledger: Pick<OpenPosition, 'symbol' | 'instrument' | 'quantity_shares'>[],
  editorTrades: Pick<TradeDraft, 'stockCode' | 'brokerageSourceKey'>[],
  assetClass: AssetClass,
): ImportCandidate[] {
  const confirmed = snapshot.filter((r) => r.review_status === 'confirmed');
  const ledgerQty = new Map<string, number>();
  for (const p of ledger) ledgerQty.set(norm(p.symbol), (ledgerQty.get(norm(p.symbol)) || 0) + Number(p.quantity_shares || 0));
  const inEditorKeys = new Set(editorTrades.map((t) => t.brokerageSourceKey).filter(Boolean) as string[]);
  const inEditorSymbols = new Set(editorTrades.map((t) => norm(t.stockCode)).filter(Boolean));

  // Same symbol may appear in several broker lots → sum per symbol.
  const bySymbol = new Map<string, { row: ConfirmedSnapshotRow; qty: number }>();
  const out: ImportCandidate[] = [];
  confirmed.forEach((r, i) => {
    const sym = norm(r.symbol);
    const type = (r.security_type || '').toLowerCase();
    const bad = !sym ? '券商未提供代號'
      : assetClass !== 'us_stock' ? '此老師帳本不是美股，無法記錄 Firstrade 持倉'
      : !SUPPORTED_TYPES.has(type) ? `週記帳本不支援此類型（${r.security_type || '未知'}）`
      : !isValidAssetSymbol(sym, assetClass) ? '代號不符合美股格式'
      : null;
    if (bad) {
      out.push({ key: `bad:${r.connection_id}:${i}`, symbol: sym || '—', name: r.name || '', snapshotQty: Number(r.quantity || 0), ledgerQty: 0, gap: 0, status: 'unsupported', reason: bad });
      return;
    }
    const cur = bySymbol.get(sym);
    bySymbol.set(sym, { row: cur?.row || r, qty: (cur?.qty || 0) + Number(r.quantity || 0) });
  });

  for (const [sym, { row, qty }] of bySymbol) {
    const lq = ledgerQty.get(sym) || 0;
    const gap = round(qty - lq);
    const key = sourceKey(row.connection_id, sym, row.as_of);
    let status: ImportStatus = gap === 0 ? 'match' : lq === 0 ? 'new' : 'diff';
    if (status !== 'match' && (inEditorKeys.has(key) || inEditorSymbols.has(sym))) status = 'in_editor';
    out.push({ key, symbol: sym, name: row.name || '', snapshotQty: round(qty), ledgerQty: round(lq), gap, status });
  }
  for (const [sym, lq] of ledgerQty) {
    if (lq !== 0 && !bySymbol.has(sym) && confirmed.length > 0) {
      out.push({ key: `ledger:${sym}`, symbol: sym, name: '', snapshotQty: 0, ledgerQty: round(lq), gap: round(-lq), status: 'ledger_only' });
    }
  }
  return out;
}

export const isImportable = (c: ImportCandidate) => c.status === 'new' || c.status === 'diff';

/**
 * Editor row for one candidate: symbol, name and |gap| only. Action, price and reasons stay empty so the
 * teacher must state the real trade; the existing validator blocks publishing without an action.
 */
export function candidateToTrade(c: ImportCandidate, assetClass: AssetClass): TradeDraft {
  if (!isImportable(c)) throw new Error(`not importable: ${c.status}`);
  return {
    ...emptyTrade(assetClass),
    stockCode: c.symbol,
    stockName: c.name,
    quantity: String(Math.abs(c.gap)),
    action: '',
    priceHint: '',
    brokerageSourceKey: c.key,
  };
}

/** Appends importable candidates, skipping anything already in the editor (idempotent re-import). */
export function mergeImport(trades: TradeDraft[], picks: ImportCandidate[], assetClass: AssetClass): TradeDraft[] {
  const keys = new Set(trades.map((t) => t.brokerageSourceKey).filter(Boolean));
  const syms = new Set(trades.map((t) => norm(t.stockCode)).filter(Boolean));
  const add = picks.filter((c) => isImportable(c) && !keys.has(c.key) && !syms.has(c.symbol)).map((c) => candidateToTrade(c, assetClass));
  if (!add.length) return trades;
  const isBlank = (t: TradeDraft) => !t.stockCode && !t.quantity && !t.priceHint && !t.reasonSummary && !t.action;
  const base = trades.length === 1 && isBlank(trades[0]) ? [] : trades;
  return [...base, ...add];
}
