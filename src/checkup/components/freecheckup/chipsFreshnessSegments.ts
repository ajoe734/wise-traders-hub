/**
 * H6 · 分段新鮮度（單一資料源）
 *
 * 語意分離：「三大法人／價量」與「券商分點 BSR」是兩個獨立的上游來源，
 * 各自有自己的 as_of 與狀態，**不得**用同一顆 FRESH/STALE 徽章代表。
 *
 * 這個模組只做純映射（payload → 兩段可渲染的 segment），
 * 不碰 DOM、不打 API、不寫任何狀態，方便單測與 E2E 斷言。
 */
import type { TwChipsPayload } from '@/checkup/lib/chipsRepository';
import {
  BSR_TERMINAL_SEG_STATE,
  BSR_TEXT_UNAVAILABLE,
  BSR_TEXT_INELIGIBLE,
  isTerminalUnavailable,
  mapProviderState,
} from '@/checkup/lib/bsrCanonicalCodes';

/** terminal／不可用共用文案：不指名上游、不承諾時間、不露內部 code。 */
function unavailableText(asOf: string | null): string {
  return asOf ? `${BSR_TEXT_UNAVAILABLE} · 顯示最後可得資料 ${asOf}` : BSR_TEXT_UNAVAILABLE;
}

export type SegmentTone = 'ok' | 'warn' | 'error' | 'muted';

export interface FreshnessSegment {
  /** 'institutional' = 三大法人（TWSE T86 / TPEx 3insti）；'bsr' = 券商分點 */
  key: 'institutional' | 'bsr';
  label: string;
  /** 機器可讀狀態，E2E 以 data-seg-state 斷言 */
  state: string;
  tone: SegmentTone;
  /** 這一段自己的資料日期（YYYY/MM/DD），無資料為 null */
  asOf: string | null;
  /** 使用者可讀的一行說明 */
  text: string;
  title: string;
}

function fmtDate(d: string | null | undefined): string | null {
  return d ? String(d).split('-').join('/') : null;
}

export function buildInstitutionalSegment(data: TwChipsPayload | null): FreshnessSegment {
  const asOf = fmtDate(data?.as_of);
  const lag = Number(data?.as_of_lag_days ?? 0);
  if (!asOf) {
    return {
      key: 'institutional',
      label: '三大法人',
      state: 'no_data',
      tone: 'muted',
      asOf: null,
      text: '尚未同步',
      title: '三大法人資料來源：TWSE T86／TPEx 三大法人買賣明細；每交易日收盤後同步',
    };
  }
  const lagging = lag >= 2;
  return {
    key: 'institutional',
    label: '三大法人',
    state: lagging ? 'lagging' : 'fresh',
    tone: lagging ? 'warn' : 'ok',
    asOf,
    text: lagging ? `${asOf}（落後 ${lag} 日）` : asOf,
    title: '三大法人資料來源：TWSE T86／TPEx 三大法人買賣明細；每交易日收盤後同步',
  };
}

export function buildBsrSegment(data: TwChipsPayload | null): FreshnessSegment {
  const asOf = fmtDate(data?.bsr_as_of);
  const status = data?.bsr_freshness_status ?? (asOf ? 'lagging' : 'no_data');
  const lagWd = data?.bsr_lag_weekdays ?? null;
  const providerState = mapProviderState(
    data?.bsr_provider_state ?? data?.bsr_sync_status?.provider_state ?? null,
  );
  const terminal = isTerminalUnavailable({
    providerState: data?.bsr_provider_state ?? data?.bsr_sync_status?.provider_state ?? null,
    providerCode:
      (data as any)?.bsr_provider_code ?? (data as any)?.bsr_terminal_code ??
      (data as any)?.bsr_sync_status?.provider_code ?? null,
  });
  const base = {
    key: 'bsr' as const,
    label: '券商分點',
    asOf,
    title: '券商分點（BSR）資料來源與三大法人不同；目前無授權可用的官方全市場來源，可能長時間停留在舊日期',
  };

  // Plan v2：provider_state 優先於 queue 導出的 freshness。
  // queue pending 不等於「正在同步」——上游若是永久拒絕，重試永遠不會成功。
  if (providerState === 'ineligible') {
    return { ...base, state: 'ineligible', tone: 'muted', text: BSR_TEXT_INELIGIBLE };
  }
  if (terminal) {
    // canonical terminal：狀態一律 unavailable_unsupported，文案不得指名上游或方案。
    return { ...base, state: BSR_TERMINAL_SEG_STATE, tone: 'error', text: unavailableText(asOf) };
  }
  if (providerState === 'unknown_degraded') {
    return {
      ...base,
      state: 'unknown_degraded',
      tone: 'warn',
      text: asOf ? `${asOf} · 上游狀態待確認，暫不承諾更新時間` : '上游狀態待確認，暫不承諾更新時間',
    };
  }
  if (providerState === 'retryable') {
    return {
      ...base,
      state: 'syncing',
      tone: 'warn',
      text: asOf ? `${asOf} · 同步中，將自動重試` : '同步中，將自動重試',
    };
  }

  // 舊／新端點都可能回 'unsupported'（不在 payload 型別列舉內），一律落 canonical terminal。
  if (String(status) === 'unsupported') {
    return { ...base, state: BSR_TERMINAL_SEG_STATE, tone: 'error', text: unavailableText(asOf) };
  }

  switch (status) {
    case 'ineligible':
      return { ...base, state: 'ineligible', tone: 'muted', text: BSR_TEXT_INELIGIBLE };
    case 'fresh':
      return { ...base, state: 'fresh', tone: 'ok', text: asOf ?? '—' };
    case 'syncing':
      return { ...base, state: 'syncing', tone: 'warn', text: asOf ? `${asOf} · 同步中` : '同步中' };
    case 'lagging':
      return {
        ...base,
        state: 'lagging',
        tone: 'warn',
        text: asOf ? `${asOf}（落後 ${lagWd ?? 1} 個交易日）` : '資料落後',
      };
    case 'sync_failed':
    case 'not_queued':
    case 'no_data':
    default:
      return {
        ...base,
        state: status === 'sync_failed' ? 'unavailable_failed' : 'unavailable',
        tone: 'error',
        text: unavailableText(asOf),
      };
  }
}


export function buildFreshnessSegments(data: TwChipsPayload | null): FreshnessSegment[] {
  return [buildInstitutionalSegment(data), buildBsrSegment(data)];
}

export function segmentColor(tone: SegmentTone, WB: any): string {
  if (tone === 'ok') return WB?.inkSub ?? '#4a453e';
  if (tone === 'warn') return '#8a5a1e';
  if (tone === 'error') return '#b04a4a';
  return WB?.inkMute ?? '#8b857c';
}
