/**
 * Predict-Events Gate Rules (Shared logic)
 *
 * 此檔為 frontend 與測試共用的純函式，與 supabase/functions/checkup-predict-events
 * 內聯實作保持邏輯一致。任何規則變動兩處都要改，並更新 unit test。
 *
 * 規則：
 *  - 免費（line_free / none）：一旦做過 daily-analysis 即永久停止 predict-events
 *  - 付費（pro / basic / tester 等非免費）：
 *      a) 每日 1 次（以台灣時區當日為界）
 *      b) 僅允許台灣時間 13:30–13:40（收盤後 10 分鐘內）執行
 */

export const PREDICT_WINDOW_START_MIN = 13 * 60 + 30; // 13:30 台北時間
export const PREDICT_WINDOW_END_MIN = 13 * 60 + 40;   // 13:40 台北時間
export const FREE_TIERS = new Set(['line_free', 'none', '']);

export interface TaipeiWallClock {
  /** YYYY-MM-DD in Asia/Taipei */
  ymd: string;
  /** Minutes since midnight (0–1439) in Asia/Taipei */
  minutes: number;
  /** 0=Sun, 1=Mon, … 6=Sat */
  weekday: number;
}

/** Convert a UTC Date → Taipei wall clock (deterministic, no Intl). */
export function toTaipei(now: Date = new Date()): TaipeiWallClock {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const ymd = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const weekday = shifted.getUTCDay();
  return { ymd, minutes, weekday };
}

/** 是否落在 13:30–13:40 台北時間（含 start、不含 end）。 */
export function isInPredictWindow(now: Date = new Date()): boolean {
  const { minutes } = toTaipei(now);
  return minutes >= PREDICT_WINDOW_START_MIN && minutes < PREDICT_WINDOW_END_MIN;
}

/** 是否為免費 tier。 */
export function isFreeTier(tier: string | null | undefined): boolean {
  return FREE_TIERS.has(String(tier || ''));
}

/**
 * 下一次可預測的視窗起始時間（UTC Date）。
 * 若現在已在視窗內，回傳「今天 13:30」對應 UTC 時刻。
 * 否則回傳「下一個 13:30」對應 UTC 時刻。
 * 不考慮交易日／假日；純時間視窗（規則簡化，與 edge fn 一致）。
 */
export function nextPredictWindow(now: Date = new Date()): Date {
  const tp = toTaipei(now);
  // 把 now 推到該日 00:00 Taipei → UTC 起點 (該日 00:00+08:00 == 前一日 16:00 UTC)
  const dayStartUtc = new Date(`${tp.ymd}T00:00:00+08:00`);
  const todayStart = new Date(dayStartUtc.getTime() + PREDICT_WINDOW_START_MIN * 60 * 1000);
  if (tp.minutes < PREDICT_WINDOW_END_MIN) {
    return todayStart;
  }
  return new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; code: 'FREE_TIER_PREDICT_DISABLED'; message: string }
  | { allowed: false; code: 'PAID_TIER_OUT_OF_WINDOW'; message: string; nextWindowUtc: string }
  | { allowed: false; code: 'PAID_TIER_DAILY_USED'; message: string; nextWindowUtc: string };

export interface GateInput {
  tier: string | null | undefined;
  /** Free tier 是否已用過 daily-analysis（任何時點）。 */
  hasDailyAnalysis: boolean;
  /** Paid tier 今日（Taipei）是否已用過 predict-events。 */
  paidUsedToday: boolean;
  /** 現在時間，預設 new Date()。 */
  now?: Date;
}

export function evaluatePredictGate(input: GateInput): GateDecision {
  const now = input.now ?? new Date();
  if (isFreeTier(input.tier)) {
    if (input.hasDailyAnalysis) {
      return {
        allowed: false,
        code: 'FREE_TIER_PREDICT_DISABLED',
        message: '免費用戶在使用過收盤分析後，事件預測會停止；訂閱後可持續使用。',
      };
    }
    return { allowed: true };
  }
  // Paid
  if (!isInPredictWindow(now)) {
    return {
      allowed: false,
      code: 'PAID_TIER_OUT_OF_WINDOW',
      message: '事件預測每日僅於台灣時間 13:30–13:40（收盤後 10 分鐘內）執行一次。',
      nextWindowUtc: nextPredictWindow(now).toISOString(),
    };
  }
  if (input.paidUsedToday) {
    return {
      allowed: false,
      code: 'PAID_TIER_DAILY_USED',
      message: '事件預測每日 1 次額度已用，請明日 13:30 後再試。',
      nextWindowUtc: nextPredictWindow(now).toISOString(),
    };
  }
  return { allowed: true };
}

/** 格式化視窗起始為「YYYY/MM/DD 13:30 (台灣時間)」。 */
export function formatNextWindowLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const { ymd } = toTaipei(d);
  const [y, m, day] = ymd.split('-');
  return `${y}/${m}/${day} 13:30（台灣時間）`;
}
