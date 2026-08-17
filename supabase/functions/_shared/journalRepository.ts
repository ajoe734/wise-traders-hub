/**
 * 週記讀取倉庫（Deno 側唯一資料源）。
 *
 * `expert_signals` 的「週記讀取」四個場景 — 訂閱者列表、擁有者預覽、
 * 匯出、LINE 推播 — 的 select 契約、status 過濾、experts join 與排序
 * 只准住在這裡。前台鏡像：src/lib/journalRepository.ts。
 *
 * 為什麼：同一張表原本被 20 個前台檔與 8 支 edge function 各自查詢，
 * 每處自訂可見性規則，導致「導師看不到自己的預覽」與「currency 欄位
 * 不存在」等事故。可見性規則沒有唯一實作處，就一定會漂移。
 */

import { taipeiMondayOf, taipeiWeekRangeUtc } from './weekBoundary.ts';
import {
  gateSignalEconomics,
  READY_PROJECTION,
  type ProjectionStatus,
} from './publicEconomicContract.ts';

// ── select 契約 ───────────────────────────────────────────────────────────────

/** 訂閱者列表：不含 quantity（列表不顯示部位大小）。 */
export const JOURNAL_LIST_SELECT =
  'id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url, asset_class, currency)';

/** 單篇 / 同週：含 quantity 與單位，供教學明細渲染。 */
export const JOURNAL_DETAIL_SELECT =
  'id, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url, currency, asset_class)';

/** 匯出：需要 status / created_at，且以 experts!inner 強制 mentor。 */
export const JOURNAL_EXPORT_SELECT =
  'id, status, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, created_at, executed_at, expert_id, experts!inner(name, slug, role, asset_class, currency)';

/** 推播：Flex message builder 需要整列（含 batch_id / teaching 欄位）。 */
export const JOURNAL_PUSH_SELECT = '*';

// ── 型別 ─────────────────────────────────────────────────────────────────────

export interface JournalDb {
  from(table: string): any;
  rpc?(fn: string, args: Record<string, unknown>): any;
}

export type JournalFetchSource = 'rls' | 'owner_rpc' | 'none';

export interface JournalFetchDiagnostics {
  source: JournalFetchSource;
  rlsError: string | null;
  rlsHitRow: boolean;
  ownerRpcAttempted: boolean;
  ownerRpcError: string | null;
  forceOwner: boolean;
  signalId: string;
  ownerExpertId: string | null;
  fetchedAt: string;
}

export interface OwnerPreviewResult<T = any> {
  signal: T | null;
  weekSignals: T[];
  error: string | null;
  diagnostics: JournalFetchDiagnostics;
}

// ── 讀取場景 ──────────────────────────────────────────────────────────────────

/**
 * 訂閱者的週記列表。呼叫端只負責決定「哪些 mentor 可看」，
 * status=published 與排序由本模組固定。
 */
export async function forSubscriber<T = any>(
  db: JournalDb,
  opts: { mentorIds: string[]; limit?: number; projection?: ProjectionStatus },
): Promise<{ signals: T[]; error: string | null }> {
  if (!opts.mentorIds || opts.mentorIds.length === 0) return { signals: [], error: null };
  const { data, error } = await db
    .from('expert_signals')
    .select(JOURNAL_LIST_SELECT)
    .eq('status', 'published')
    .in('expert_id', opts.mentorIds)
    .order('published_at', { ascending: false })
    .limit(opts.limit ?? 100);
  // R1-P typed public contract: subscriber-facing rows lose every economic
  // figure while the projection scope is under review / incomplete.
  const gated = gateSignalEconomics(
    (data ?? []) as unknown as Record<string, unknown>[],
    opts.projection ?? READY_PROJECTION,
  ) as unknown as T[];
  return { signals: gated, error: error?.message ?? null };
}

/**
 * 單篇週記 + 同週其他篇。RLS 拉不到時（擁有者預覽自己未公開的內容）
 * 改走 SECURITY DEFINER 的 `get_owned_journal_bundle`。
 */
export async function forOwnerPreview<T = any>(
  db: JournalDb,
  opts: { signalId: string; forceOwner?: boolean },
): Promise<OwnerPreviewResult<T>> {
  const forceOwner = !!opts.forceOwner;
  const diagnostics: JournalFetchDiagnostics = {
    source: 'none',
    rlsError: null,
    rlsHitRow: false,
    ownerRpcAttempted: false,
    ownerRpcError: null,
    forceOwner,
    signalId: opts.signalId,
    ownerExpertId: null,
    fetchedAt: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('expert_signals')
    .select(JOURNAL_DETAIL_SELECT)
    .eq('id', opts.signalId)
    .maybeSingle();

  const signal = (data ?? null) as T | null;
  diagnostics.rlsError = error?.message ?? null;
  diagnostics.rlsHitRow = !!signal;
  let fetchError: string | null = error?.message ?? null;

  if (!signal && forceOwner && typeof db.rpc === 'function') {
    diagnostics.ownerRpcAttempted = true;
    const { data: rpcData, error: rpcErr } = await db.rpc('get_owned_journal_bundle', {
      _signal_id: opts.signalId,
    });
    if (rpcErr) {
      diagnostics.ownerRpcError = rpcErr.message;
      fetchError = rpcErr.message;
    }
    if (rpcData && (rpcData as any).signal) {
      const bundle = rpcData as any;
      diagnostics.source = 'owner_rpc';
      diagnostics.ownerExpertId = bundle.signal?.expert_id ?? null;
      return {
        signal: bundle.signal as T,
        weekSignals: (bundle.weekSignals ?? []) as T[],
        error: null,
        diagnostics,
      };
    }
  }

  if (!signal) {
    return {
      signal: null,
      weekSignals: [],
      error: fetchError ?? 'not_found_or_forbidden',
      diagnostics,
    };
  }

  diagnostics.source = 'rls';
  const s = signal as any;
  diagnostics.ownerExpertId = s.expert_id ?? null;

  const { startIso, endIso } = taipeiWeekRangeUtc(taipeiMondayOf(new Date(s.published_at)));
  const { data: weekData } = await db
    .from('expert_signals')
    .select(JOURNAL_DETAIL_SELECT)
    .eq('expert_id', s.expert_id)
    .eq('status', 'published')
    .gte('published_at', startIso)
    .lt('published_at', endIso)
    .order('published_at', { ascending: false });

  return {
    signal,
    weekSignals: (weekData ?? []) as T[],
    error: null,
    diagnostics,
  };
}

/**
 * 匯出用：某一週的 mentor 週記。
 * publishedOnly=true 以 published_at 落在該週為準；
 * false（含草稿／撤回）以 created_at 為準 — 這條規則過去在前台與
 * edge function 各寫一次，現在只有這裡。
 */
export async function forExport<T = any>(
  db: JournalDb,
  opts: { startIso: string; endIso: string; publishedOnly?: boolean },
): Promise<{ rows: T[]; error: string | null }> {
  const publishedOnly = opts.publishedOnly !== false;
  let q = db.from('expert_signals').select(JOURNAL_EXPORT_SELECT).eq('experts.role', 'mentor');

  if (publishedOnly) {
    q = q
      .eq('status', 'published')
      .gte('published_at', opts.startIso)
      .lt('published_at', opts.endIso)
      .order('expert_id', { ascending: true })
      .order('published_at', { ascending: true });
  } else {
    q = q
      .gte('created_at', opts.startIso)
      .lt('created_at', opts.endIso)
      .order('expert_id', { ascending: true })
      .order('created_at', { ascending: true });
  }

  const { data, error } = await q;
  return { rows: (data ?? []) as T[], error: error?.message ?? null };
}

/** LINE 推播：單篇。 */
export async function forPush<T = any>(
  db: JournalDb,
  opts: { signalId: string },
): Promise<{ signal: T | null; error: string | null }> {
  const { data, error } = await db
    .from('expert_signals')
    .select(JOURNAL_PUSH_SELECT)
    .eq('id', opts.signalId)
    .maybeSingle();
  return { signal: (data ?? null) as T | null, error: error?.message ?? null };
}

/** LINE 推播：整批（同一 batch_id）。 */
export async function forPushBatch<T = any>(
  db: JournalDb,
  opts: { expertId: string; batchId: string },
): Promise<{ signals: T[]; error: string | null }> {
  const { data, error } = await db
    .from('expert_signals')
    .select(JOURNAL_PUSH_SELECT)
    .eq('expert_id', opts.expertId)
    .eq('batch_id', opts.batchId)
    .order('executed_at', { ascending: true, nullsFirst: false });
  return { signals: (data ?? []) as T[], error: error?.message ?? null };
}
