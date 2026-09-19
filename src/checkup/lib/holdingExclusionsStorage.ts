/**
 * holdingExclusionsStorage — 排除清單的本機讀寫（唯一入口）。
 *
 * 獨立成檔的理由：bootstrap（.js）與 trade capture runtime（.js）都需要在
 * replay / 截圖匯入時讀排除清單，但不該相依 React hook。
 */
import {
  HOLDING_EXCLUSIONS_KEY,
  parseExclusions,
  planManualReAdd,
  type HoldingExclusion,
} from './holdingExclusions';

export function readLocalExclusions(): HoldingExclusion[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(HOLDING_EXCLUSIONS_KEY);
    return raw ? parseExclusions(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeLocalExclusions(rows: HoldingExclusion[]): void {
  try {
    localStorage.setItem(HOLDING_EXCLUSIONS_KEY, JSON.stringify(rows));
  } catch {
    /* noop */
  }
}

/**
 * 手動重新加入同一檔 → 清除該檔排除標記（本機唯一入口）。
 * 回傳是否真的清掉，供 UI 決定要不要提示使用者。
 */
export function clearLocalExclusion(code: unknown): boolean {
  const plan = planManualReAdd({ exclusions: readLocalExclusions(), code });
  if (!plan.cleared) return false;
  writeLocalExclusions(plan.nextExclusions);
  return true;
}
