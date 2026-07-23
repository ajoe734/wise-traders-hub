// _shared/seriesReadiness.ts
// 唯一真相：三大法人 / BSR 集中度 序列在 5/20/60 日視窗的完整度判定。
// 對外只暴露 4 個使用者可讀狀態，其餘診斷欄位供 debug。
// tw-chips-detail 與 ChipsTrendChart 均讀此結果，不再各自 slice。

export type ReadinessState = 'ready' | 'filling' | 'upstream_exhausted' | 'no_data';

export type WindowReadiness = {
  window_days: 5 | 20 | 60;
  state: ReadinessState;
  have: number;
  need: number;
  oldest_available: string | null;
  newest_available: string | null;
  // 內部 debug（UI 不顯示）：更細的原因
  detail: 'ready' | 'partial_filling' | 'no_series' | 'upstream_shallow' | 'insufficient';
};

export type ReadinessInput = {
  /** ISO 日期升冪，代表該序列已存在的「有效」交易日（rowCount 已達門檻的日期）。 */
  validDatesAsc: string[];
  /** 若上游可用歷史已知的最早日期（例如新股上市日或 FinMind 首個可用日）；未知傳 null。 */
  upstreamOldest?: string | null;
  /** 是否已探到上游底部，代表再往前也不會有資料。 */
  upstreamExhausted?: boolean;
};

const WINDOWS: Array<5 | 20 | 60> = [5, 20, 60];

export function resolveWindow(
  input: ReadinessInput,
  window_days: 5 | 20 | 60,
): WindowReadiness {
  const have = input.validDatesAsc.length;
  const newest = have ? input.validDatesAsc[have - 1] : null;
  const oldest = have ? input.validDatesAsc[0] : null;

  if (have === 0) {
    return {
      window_days,
      state: input.upstreamExhausted ? 'upstream_exhausted' : 'no_data',
      have: 0,
      need: window_days,
      oldest_available: null,
      newest_available: null,
      detail: input.upstreamExhausted ? 'upstream_shallow' : 'no_series',
    };
  }

  if (have >= window_days) {
    return {
      window_days,
      state: 'ready',
      have,
      need: window_days,
      oldest_available: oldest,
      newest_available: newest,
      detail: 'ready',
    };
  }

  // have < window_days
  if (input.upstreamExhausted) {
    return {
      window_days,
      state: 'upstream_exhausted',
      have,
      need: window_days,
      oldest_available: oldest,
      newest_available: newest,
      detail: 'upstream_shallow',
    };
  }

  return {
    window_days,
    state: 'filling',
    have,
    need: window_days,
    oldest_available: oldest,
    newest_available: newest,
    detail: have > 0 ? 'partial_filling' : 'insufficient',
  };
}

export function resolveAllWindows(input: ReadinessInput): Record<'5' | '20' | '60', WindowReadiness> {
  return {
    '5': resolveWindow(input, 5),
    '20': resolveWindow(input, 20),
    '60': resolveWindow(input, 60),
  };
}

/** 使用者可讀文案（不承諾具體時間）。 */
export function readinessCopy(r: WindowReadiness): string {
  switch (r.state) {
    case 'ready':
      return '';
    case 'filling':
      return `補齊中：已 ${r.have}/${r.need} 個交易日`;
    case 'upstream_exhausted':
      return r.oldest_available
        ? `此檔歷史自 ${r.oldest_available.replaceAll('-', '/')} 起，${r.need} 日視窗資料不足`
        : `此檔上游歷史不足 ${r.need} 個交易日`;
    case 'no_data':
      return '暫無資料，正在收集';
  }
}
