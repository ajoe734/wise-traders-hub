/**
 * readinessLabel —— 視窗覆蓋計數的顯示語意（前台鏡像）。
 *
 * 與 `supabase/functions/_shared/seriesReadiness.ts` 的
 * `readinessCountLabel` / `isWindowCovered` 為同一份規則，
 * 由 `src/test/unit/bsr-window-count-semantics.test.ts` 鎖定兩邊一致。
 *
 * 語意硬合約：分子是「落在該視窗內的交易日數」，必須夾在分母上限內；
 * `readiness.have` 是整條序列的有效天數（最多 60 天），直接印出來會出現
 * 「27/5」這種分子大於分母的錯誤計數。
 */
export interface WindowCount {
  have: number;
  need: number;
}

export function readinessCountLabel(r: WindowCount): string {
  const need = Math.max(0, Math.trunc(r.need) || 0);
  const raw = Math.trunc(r.have) || 0;
  const have = Math.max(0, Math.min(raw, need));
  return `${have}/${need}`;
}

export function isWindowCovered(r: WindowCount): boolean {
  return r.need > 0 && r.have >= r.need;
}

/** 視窗覆蓋的使用者可讀文案；已補滿時回 null（不顯示）。 */
export function windowCoverageText(r: WindowCount | null | undefined, windowDays: number): string | null {
  if (!r || r.have <= 0) return null;
  const c: WindowCount = { have: r.have, need: windowDays };
  if (isWindowCovered(c)) return null;
  return `僅 ${readinessCountLabel(c)} 個交易日`;
}
