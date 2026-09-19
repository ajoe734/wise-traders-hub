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
