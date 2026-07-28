/**
 * 美股選擇權「原生組合單」單一來源。
 *
 * 設計原則：
 * - 一張組合單 = 一筆 expert_signals（quantity_unit = '組'）+ N 筆 expert_signal_legs
 * - 每組的淨權利金 / 最大損失 / 最大獲利，一律用「到期損益曲線」通用演算法算，
 *   不針對個別策略寫死公式，這樣垂直價差、鐵兀鷹、蝶式、比例價差都能共用。
 * - 合約乘數固定 100（美股標準股票選擇權）。
 */

export const OPTION_CONTRACT_MULTIPLIER = 100;

export type OptionRight = 'C' | 'P';
export type LegSide = 'long' | 'short';

export type ComboStrategy =
  | 'vertical_call'
  | 'vertical_put'
  | 'iron_condor'
  | 'straddle'
  | 'strangle'
  | 'custom';

export const COMBO_STRATEGY_LABELS: Record<ComboStrategy, string> = {
  vertical_call: '買權價差（Call Spread）',
  vertical_put: '賣權價差（Put Spread）',
  iron_condor: '鐵兀鷹（Iron Condor）',
  straddle: '跨式（Straddle）',
  strangle: '勒式（Strangle）',
  custom: '自訂組合',
};

export interface ComboLeg {
  /** 標的（AAPL / SNDK…） */
  underlying: string;
  /** YYYY-MM-DD */
  expiry: string;
  right: OptionRight;
  strike: number;
  side: LegSide;
  /** 口數比例，預設 1 */
  ratio: number;
  /** 每股權利金（非合約總價） */
  price: number;
}

export interface ComboMetrics {
  /** 每組淨權利金（USD）。正 = 收權利金 credit，負 = 付出 debit */
  netPremium: number;
  /** 每組最大損失（USD，正值）。null = 風險無限（裸賣） */
  maxLossPerUnit: number | null;
  /** 每組最大獲利（USD，正值）。null = 獲利無上限 */
  maxProfitPerUnit: number | null;
  /** 是否為風險有限（可發布）的組合 */
  definedRisk: boolean;
}

export function emptyComboLeg(underlying = '', expiry = ''): ComboLeg {
  return { underlying, expiry, right: 'C', strike: 0, side: 'long', ratio: 1, price: 0 };
}

/** 建 OCC 21 字元代碼：Root + YYMMDD + C/P + 8 位履約價（千分之一美元） */
export function buildOccSymbol(leg: Pick<ComboLeg, 'underlying' | 'expiry' | 'right' | 'strike'>): string {
  const root = String(leg.underlying || '').trim().toUpperCase();
  const d = String(leg.expiry || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!root || !m) return '';
  const yymmdd = `${m[1].slice(2)}${m[2]}${m[3]}`;
  const strikeInt = Math.round(Number(leg.strike || 0) * 1000);
  if (!Number.isFinite(strikeInt) || strikeInt <= 0) return '';
  return `${root}${yymmdd}${leg.right}${String(strikeInt).padStart(8, '0')}`;
}

function intrinsic(right: OptionRight, strike: number, spot: number): number {
  return right === 'C' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/** 每組淨權利金（USD）。賣方收錢為正。 */
export function calcNetPremium(legs: ComboLeg[]): number {
  return legs.reduce((sum, l) => {
    const cash = Number(l.price || 0) * Math.max(1, Number(l.ratio || 1)) * OPTION_CONTRACT_MULTIPLIER;
    return sum + (l.side === 'short' ? cash : -cash);
  }, 0);
}

/** 到期時，標的價 spot 下的每組總損益（USD） */
export function payoffAt(legs: ComboLeg[], spot: number): number {
  const intrinsicPnl = legs.reduce((sum, l) => {
    const v = intrinsic(l.right, Number(l.strike || 0), spot)
      * Math.max(1, Number(l.ratio || 1))
      * OPTION_CONTRACT_MULTIPLIER;
    return sum + (l.side === 'long' ? v : -v);
  }, 0);
  return intrinsicPnl + calcNetPremium(legs);
}

/**
 * 通用到期損益分析：檢查 0、每個履約價 ±ε、以及遠高於最高履約價的價位。
 * 因為到期損益是分段線性，極值必定落在這些節點或無限遠方向。
 */
export function analyzeCombo(legs: ComboLeg[]): ComboMetrics {
  const valid = (legs || []).filter((l) => Number(l.strike) > 0 && (l.right === 'C' || l.right === 'P'));
  const netPremium = calcNetPremium(valid);
  if (valid.length === 0) {
    return { netPremium: 0, maxLossPerUnit: null, maxProfitPerUnit: null, definedRisk: false };
  }

  const strikes = Array.from(new Set(valid.map((l) => Number(l.strike)))).sort((a, b) => a - b);
  const hi = strikes[strikes.length - 1];
  const probes = [0, ...strikes, hi * 2 + 100];
  const values = probes.map((s) => payoffAt(valid, s));

  // 判斷極遠端斜率（是否風險/獲利無限）
  const far1 = payoffAt(valid, hi * 2 + 100);
  const far2 = payoffAt(valid, hi * 4 + 200);
  const upSlope = far2 - far1;
  const zero = payoffAt(valid, 0);
  const near = payoffAt(valid, Math.min(strikes[0], 1) / 2);
  const downSlope = zero - near; // 往 0 方向

  let minV = Math.min(...values);
  let maxV = Math.max(...values);

  const lossUnbounded = upSlope < -1e-9 || downSlope < -1e-9;
  const profitUnbounded = upSlope > 1e-9 || downSlope > 1e-9;

  if (lossUnbounded) minV = -Infinity;
  if (profitUnbounded) maxV = Infinity;

  const maxLossPerUnit = minV === -Infinity ? null : Math.max(0, -Math.min(0, minV));
  const maxProfitPerUnit = maxV === Infinity ? null : Math.max(0, maxV);

  return {
    netPremium: round2(netPremium),
    maxLossPerUnit: maxLossPerUnit === null ? null : round2(maxLossPerUnit),
    maxProfitPerUnit: maxProfitPerUnit === null ? null : round2(maxProfitPerUnit),
    definedRisk: maxLossPerUnit !== null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 依 legs 自動判斷策略種類（僅用於顯示，可被使用者覆寫） */
export function detectComboStrategy(legs: ComboLeg[]): ComboStrategy {
  const v = legs.filter((l) => Number(l.strike) > 0);
  if (v.length === 2) {
    const [a, b] = v;
    if (a.right === b.right && a.side !== b.side) {
      return a.right === 'C' ? 'vertical_call' : 'vertical_put';
    }
    if (a.right !== b.right && a.side === b.side) {
      return a.strike === b.strike ? 'straddle' : 'strangle';
    }
  }
  if (v.length === 4) {
    const calls = v.filter((l) => l.right === 'C');
    const puts = v.filter((l) => l.right === 'P');
    if (calls.length === 2 && puts.length === 2) return 'iron_condor';
  }
  return 'custom';
}

/** 組合單顯示字串，例：`SNDK 950/925P + 1600/1625C` */
export function formatComboLabel(legs: ComboLeg[]): string {
  const v = legs.filter((l) => Number(l.strike) > 0);
  if (v.length === 0) return '';
  const underlying = v[0].underlying?.trim().toUpperCase() || '';
  const groups = new Map<string, ComboLeg[]>();
  v.forEach((l) => {
    const k = `${l.expiry}|${l.right}`;
    groups.set(k, [...(groups.get(k) || []), l]);
  });
  const parts: string[] = [];
  Array.from(groups.entries()).forEach(([k, ls]) => {
    const right = k.split('|')[1];
    const strikes = ls
      .slice()
      .sort((a, b) => (a.side === b.side ? a.strike - b.strike : a.side === 'short' ? -1 : 1))
      .map((l) => trimNum(l.strike));
    parts.push(`${strikes.join('/')}${right}`);
  });
  return `${underlying} ${parts.join(' + ')}`.trim();
}

function trimNum(n: number): string {
  const x = Number(n || 0);
  return Number.isInteger(x) ? String(x) : String(x);
}

export interface ComboValidationResult {
  ok: boolean;
  error?: string;
  metrics?: ComboMetrics;
}

/** 發布前檢查：腿數、標的一致、履約價、價格、風險有限。 */
export function validateCombo(legs: ComboLeg[]): ComboValidationResult {
  const v = legs || [];
  if (v.length < 2) return { ok: false, error: '組合單至少要有 2 腿' };
  const underlyings = new Set(v.map((l) => String(l.underlying || '').trim().toUpperCase()).filter(Boolean));
  if (underlyings.size !== 1) return { ok: false, error: '組合單的所有腿必須是同一個標的' };
  for (let i = 0; i < v.length; i++) {
    const tag = `第 ${i + 1} 腿`;
    const l = v[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.expiry || ''))) return { ok: false, error: `${tag}：請填到期日` };
    if (!(Number(l.strike) > 0)) return { ok: false, error: `${tag}：請填履約價` };
    if (!(Number(l.price) > 0)) return { ok: false, error: `${tag}：請填權利金` };
    if (!buildOccSymbol(l)) return { ok: false, error: `${tag}：無法組出 OCC 代碼，請檢查標的／到期日／履約價` };
  }
  const metrics = analyzeCombo(v);
  if (!metrics.definedRisk) {
    return { ok: false, error: '此組合為風險無限（含裸賣腿），目前不支援發布，請補上保護腿' };
  }
  return { ok: true, metrics };
}
