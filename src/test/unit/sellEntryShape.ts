/**
 * mergeTradeIntoHoldings 形狀契約的獨立可測版本。
 *
 * FreeCheckup.jsx 內的 mergeTradeIntoHoldings 不可 import（非 export），
 * 這裡以 holdings.js 的 applyTradeEntryToHoldings（replay 權威）驗證
 * buildSellTradeEntry 產出的列可被既有管線直接消化：
 *  - 全數賣出 → 該檔移出持倉
 *  - 部分賣出 → 股數扣減
 */
import { applyTradeEntryToHoldings, normalizeHoldings } from '@/checkup/lib/holdings';
import { buildSellTradeEntry } from '@/checkup/lib/holdingDeleteService';

export function mergeTradeIntoHoldingsShapeContract(): boolean {
  const now = new Date('2026-09-30T03:30:00.000Z');
  const holdings = [
    { code: '2338', name: '光罩', qty: 1000, cost: 40, price: 61.8 },
    { code: '6706', name: '惠特', qty: 500, cost: 100, price: 500 },
  ];

  const full = buildSellTradeEntry({ code: '2338', name: '光罩', qty: 1000, price: 61.8, heldQty: 1000, now });
  if (!full.ok) return false;
  const afterFull = normalizeHoldings(applyTradeEntryToHoldings(holdings, full.entry));
  if (afterFull.some((h) => h.code === '2338')) return false;
  if (!afterFull.some((h) => h.code === '6706')) return false;

  const partial = buildSellTradeEntry({ code: '6706', name: '惠特', qty: 200, price: 500, heldQty: 500, now });
  if (!partial.ok) return false;
  const afterPartial = normalizeHoldings(applyTradeEntryToHoldings(afterFull, partial.entry));
  const kept = afterPartial.find((h) => h.code === '6706');
  return !!kept && Number(kept.qty) === 300;
}
