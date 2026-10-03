/**
 * 前瞻與同業估值證據（純函式，零 I/O）。
 *
 * 課程流程：同期間營收→毛利/費用/業外/稅/歸母淨利→適當股數與稀釋→前瞻 EPS→
 * 有來源且調整成長/產品/客戶/風險的倍數→條件情境價。
 *
 * 硬規則：
 *  - 前瞻分母只來自使用者自填的具名來源，或 provider 明示 kind='forecast'；現有 provider 只有已公布分母。
 *  - 歷史 TTM 倍數只當背景，不得乘前瞻分母（期間不一致 → 不產生情境價）。
 *  - 同業中位／最高不得自動變合理價或上緣；缺折溢價理由只列「未調整參照」。
 *  - 少量公開快照不是完整每日分布；沒有校準模型 → 機率未知。
 */
import type { CustomScenarioInput, ScenarioKey, ScenarioRow, ValuationScenario } from './valuationScenario';

export type BasisPeriod = string; // 'FY2027' | '未來四季' | 'TTM' | '最新季末'
export type MultipleKind = 'forward' | 'ttm';

export const FORWARD_PERIOD_RE = /^(FY20\d{2}|未來四季)$/;
export const PERIOD_RE = /^(FY20\d{2}|未來四季|TTM|最新季末)$/;

export const isForwardPeriod = (p: string | null | undefined) => !!p && FORWARD_PERIOD_RE.test(p);

export function periodOptions(today: string, key: ScenarioKey | null): string[] {
  const y = Number(today.slice(0, 4)) || 2026;
  if (key === 'pb') return ['最新季末', `FY${y}`, `FY${y + 1}`];
  return [`FY${y}`, `FY${y + 1}`, `FY${y + 2}`, '未來四季', 'TTM'];
}

/** 期間一致性：PE/PS 的倍數口徑必須與分母期間相同。PB 為時點存量，不檢查。 */
export function periodMismatch(key: ScenarioKey | null, period: string | null | undefined, kind: MultipleKind | null | undefined): string | null {
  if (!key || key === 'pb' || !period || !kind) return null;
  if (isForwardPeriod(period) && kind === 'ttm') return '歷史 TTM 倍數不能乘前瞻分母，請改用同期間前瞻倍數';
  if (period === 'TTM' && kind === 'forward') return '前瞻倍數不能乘 TTM 分母，請改用 TTM 倍數';
  return null;
}

export type Range = { low: number; high: number; n: number };
export function parseSamples(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw.split(/[,，\s、]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
}
export function rangeOf(values: number[]): Range | null {
  if (!values.length) return null;
  return { low: Math.min(...values), high: Math.max(...values), n: values.length };
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** 本公司近一年（估值日往前 365 天）已使用的 TTM 歷史資料期；只作背景。 */
export function nearYearTtm(row: ScenarioRow | null | undefined, asOf: string | null): (Range & { from: string; to: string }) | null {
  if (!row?.samples?.length || !asOf) return null;
  const start = new Date(Date.parse(`${asOf}T00:00:00Z`) - 365 * 86400_000).toISOString().slice(0, 10);
  const s = row.samples.filter((x) => x.date >= start && x.date <= asOf && Number.isFinite(x.multiple) && x.multiple > 0);
  const r = rangeOf(s.map((x) => x.multiple));
  if (!r) return null;
  const dates = s.map((x) => x.date).sort();
  return { ...r, from: dates[0], to: dates[dates.length - 1] };
}

export type ForwardEvidence = {
  key: ScenarioKey;
  forwardBasis:
    | { status: 'provider'; value: number; period: string; source: string; date: string }
    | { status: 'user'; value: number; period: string; source: string; date: string }
    | { status: 'missing'; note: string };
  ownTtm: (Range & { from: string; to: string }) | null;
  ownForward: (Range & { median: number; note: string }) | null;
  systemPeer: { status: 'verified' | 'unverified'; text: string };
  userPeer: null | { multiple: number; source: string; adjusted: boolean; text: string; vsUserLow: string | null };
  mismatch: string | null;
  probability: string;
};

export const PROBABILITY_UNKNOWN = '機率未知：沒有校準模型，不提供任何百分比。';

export function buildForwardEvidence(
  scenario: ValuationScenario | null,
  key: ScenarioKey,
  input: CustomScenarioInput | null,
): ForwardEvidence {
  const row = scenario?.rows.find((r) => r.key === key) ?? null;
  const usesKey = input?.primaryKey === key;
  const period = usesKey ? input?.basisPeriod ?? '' : '';
  let forwardBasis: ForwardEvidence['forwardBasis'];
  if (row?.basis?.kind === 'forecast') {
    forwardBasis = { status: 'provider', value: row.basis.value, period: row.basis.period, source: row.basis.source, date: row.basis.publishedAt };
  } else if (usesKey && input?.expectedBasis && input.expectedBasis > 0 && PERIOD_RE.test(period) && input.basisSource?.trim() && input.basisDate) {
    forwardBasis = { status: 'user', value: input.expectedBasis, period, source: input.basisSource.trim(), date: input.basisDate };
  } else {
    forwardBasis = { status: 'missing', note: key === 'pb'
      ? '現有資料只有已公布最新季末每股淨值；未來淨值需自填具名來源'
      : '現有資料源只有已公布 TTM 分母，未提供前瞻數字；需自填具名來源與年度/未來四季' };
  }
  const own = usesKey ? parseSamples(input?.ownSamples) : [];
  const ownR = rangeOf(own);
  const ownForward = ownR ? { ...ownR, median: median(own), note: `${ownR.n} 個公開快照，非完整每日分布` } : null;
  const systemPeer: ForwardEvidence['systemPeer'] = row?.multiples?.method === 'peer'
    ? { status: 'verified', text: `系統同業（已公布口徑）：${row.multiples.peerComparability}` }
    : { status: 'unverified', text: `系統同業：${row?.multiples?.peerComparability || '0 家或不足 3 家可比'}；且只有已公布口徑，沒有同期間前瞻倍數` };
  let userPeer: ForwardEvidence['userPeer'] = null;
  if (usesKey && input?.peerMultiple && input.peerMultiple > 0) {
    const adjusted = !!input.peerAdjustment?.trim();
    const low = input.multiple.low;
    userPeer = {
      multiple: input.peerMultiple,
      source: input.peerSource?.trim() || '未填來源',
      adjusted,
      text: adjusted
        ? `同業同期間 ${fmtX(input.peerMultiple)} 倍；折溢價理由：${input.peerAdjustment!.trim()}`
        : `同業同期間 ${fmtX(input.peerMultiple)} 倍（未調整參照，缺成長/產品/客戶/風險折溢價理由，不作合理價或上緣）`,
      vsUserLow: low && low > 0 ? `你的倍數下限相對同業 ${low >= input.peerMultiple ? '溢價' : '折價'} ${Math.abs((low / input.peerMultiple - 1) * 100).toFixed(0)}%` : null,
    };
  }
  return {
    key, forwardBasis, ownTtm: nearYearTtm(row, scenario?.asOf ?? null), ownForward, systemPeer, userPeer,
    mismatch: usesKey ? periodMismatch(key, period, input?.multipleKind ?? null) : null,
    probability: PROBABILITY_UNKNOWN,
  };
}

export const fmtX = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
