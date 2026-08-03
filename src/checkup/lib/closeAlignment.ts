/**
 * closeAlignment — 看板層「收盤對齊」彙總（純函式）。
 *
 * 回答一個問題：畫面上這批持倉的價格，是不是全部對齊了「最後一個完整交易日」？
 * 只要有一檔停在別的交易日、或根本沒有官方收盤，就必須讓使用者看見，
 * 而不是用「剛剛更新」這種抓取時間掩蓋掉。
 */
import { latestCompletedTradeDate } from './marketCalendar';

export interface HoldingCloseLike {
  code?: string;
  priceTradeDate?: string | null;
  priceState?: string | null;
  priceSource?: string | null;
}

export interface CloseAlignmentSummary {
  expected: string;
  total: number;
  confirmed: number;
  pending: number;
  /** 落在非預期交易日的日期集合（已排序） */
  otherDates: string[];
  aligned: boolean;
  label: string;
  title: string;
}

function fmt(d: string): string { return d.replace(/-/g, '/'); }

export function summarizeCloseAlignment(
  holdings: HoldingCloseLike[] | null | undefined,
  now: Date = new Date(),
): CloseAlignmentSummary {
  const expected = latestCompletedTradeDate(now, { market: 'TW' });
  const list = Array.isArray(holdings) ? holdings : [];
  let confirmed = 0;
  const others = new Set<string>();
  for (const h of list) {
    const td = h?.priceTradeDate ? String(h.priceTradeDate).slice(0, 10) : null;
    if (td === expected && h?.priceState !== 'pending') confirmed += 1;
    else if (td) others.add(td);
  }
  const total = list.length;
  const pending = Math.max(0, total - confirmed);
  const otherDates = Array.from(others).sort();
  const aligned = total > 0 && pending === 0;

  const label = aligned
    ? `收盤 ${fmt(expected)} 已對齊`
    : total === 0
      ? `收盤 ${fmt(expected)}`
      : `收盤 ${fmt(expected)} · ${pending}/${total} 待確認`;

  const title = [
    `應使用的最後完整交易日：${fmt(expected)}`,
    `已對齊 ${confirmed}／${total} 檔`,
    otherDates.length ? `其他交易日：${otherDates.map(fmt).join('、')}` : null,
    pending ? '待確認者維持前值，不以盤中報價或舊快取充當收盤' : null,
  ].filter(Boolean).join('\n');

  return { expected, total, confirmed, pending, otherDates, aligned, label, title };
}
