// @ts-nocheck
// G-Coverage（holdings audit 2026-05）：把 inline 在 FreeCheckup.jsx /
// useRouteHoldingsPage.js 內的兩個熱路徑純函式抽出到模組層，
// 讓 unit test 可以涵蓋（補回 G 批要求）。
// 行為與原 inline 版本 1:1 對齊；FreeCheckup.jsx 與 useRouteHoldingsPage.js
// 改為直接 import，hook deps 改成 [decisionsMap] / [holdingsRaw]。

export const URGENCY_RANK = { now: 3, soon: 2, monitor: 1 };
export const CONF_RANK = { high: 3, medium: 2, low: 1 };

/**
 * 建立比對函式：依 decisionsMap 的 priority / urgency / confidence / value / code 排序。
 * 與 FreeCheckup.jsx A2 inline compareByPriority 行為一致。
 */
export function makeCompareByPriority(decisionsMap = {}) {
  return function compareByPriority(a, b) {
    const da = decisionsMap[a?.code];
    const db = decisionsMap[b?.code];
    const pa = da?.priority ?? 5;
    const pb = db?.priority ?? 5;
    if (pa !== pb) return pa - pb;
    const ua = URGENCY_RANK[da?.urgency] || 0;
    const ub = URGENCY_RANK[db?.urgency] || 0;
    if (ua !== ub) return ub - ua;
    const ca = CONF_RANK[da?.confidence] || 0;
    const cb = CONF_RANK[db?.confidence] || 0;
    if (ca !== cb) return cb - ca;
    const v = (b?.value || 0) - (a?.value || 0);
    if (v !== 0) return v;
    // P6: code 字典序 tiebreaker
    return String(a?.code || '').localeCompare(String(b?.code || ''));
  };
}

/**
 * FreeCheckup 版 valueKey：code|qty|price|cost。
 * 用於穩定 H reference（B-P2 holdings audit 2026-05）。
 */
export function holdingsValueKeyShort(holdings) {
  if (!Array.isArray(holdings) || holdings.length === 0) return '';
  return holdings.map((h) => `${h.code}|${h.qty}|${h.price}|${h.cost}`).join(';');
}

/**
 * useRouteHoldingsPage 版 valueKey：code|qty|price|cost|value|pct|integrityIssue。
 * 用於 store push 後 value 未變時 derived 全部命中快取（D-Perf-R6）。
 */
export function holdingsValueKeyFull(holdings) {
  if (!Array.isArray(holdings) || holdings.length === 0) return '';
  return holdings
    .map((h) => `${h.code}|${h.qty}|${h.price}|${h.cost}|${h.value}|${h.pct}|${h.integrityIssue || ''}`)
    .join(';');
}
