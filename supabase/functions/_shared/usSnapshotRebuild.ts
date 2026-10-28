import { detectMarket } from './marketDetect.ts';

export interface OfficialUsBar {
  trade_date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  yesterday_close: number | null;
  change_percent: number | null;
}

const number = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!String(value).trim()) return null;
  const parsed = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Exchange-labelled dates only; neither prices nor UTC timestamps invent a session. */
export function parseNasdaqHistory(payload: unknown, through: string): OfficialUsBar[] {
  const data = payload as { data?: { tradesTable?: { rows?: Record<string, unknown>[] }; totalRecords?: number }; status?: { rCode?: number } };
  if (data?.status?.rCode && data.status.rCode !== 200) return [];
  const input = data?.data?.tradesTable?.rows;
  if (!Array.isArray(input)) return [];
  if (typeof data.data?.totalRecords === 'number' && data.data.totalRecords > input.length) throw new Error('Incomplete exchange history');
  const bars: OfficialUsBar[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    const match = String(row.date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) throw new Error('Invalid exchange session date');
    const date = `${match[3]}-${match[1]}-${match[2]}`;
    const parsedDate = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || seen.has(date) || [0, 6].includes(parsedDate.getUTCDay())) throw new Error('Invalid or duplicate exchange date');
    seen.add(date);
    if (date > through) continue;
    const open = number(row.open), high = number(row.high), low = number(row.low), close = number(row.close), volume = number(row.volume);
    if (open === null || high === null || low === null || close === null || volume === null || Math.min(open, high, low, close) <= 0 || volume < 0 || !Number.isSafeInteger(volume) || high < Math.max(open, close, low) || low > Math.min(open, close)) throw new Error('Invalid exchange OHLCV');
    bars.push({ trade_date: date, open_price: open, high_price: high, low_price: low, close_price: close, volume, yesterday_close: null, change_percent: null });
  }
  bars.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close_price;
    bars[i].yesterday_close = prev;
    bars[i].change_percent = Math.round((bars[i].close_price / prev - 1) * 10000) / 100;
  }
  return bars;
}

export function nasdaqAssetClass(symbol: string): 'stocks' | 'etf' | null {
  if (detectMarket(symbol) !== 'US') return null;
  return ['SOXL', 'UGL', 'SPCX'].includes(symbol) ? 'etf' : 'stocks';
}

/** At capture time the latest NY session must already have closed, including DST. */
export function completedSessionAt(capturedAt: string, bars: OfficialUsBar[]): OfficialUsBar | null {
  const captured = new Date(capturedAt);
  if (!Number.isFinite(captured.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(captured);
  const fields = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const day = `${fields.year}-${fields.month}-${fields.day}`;
  return [...bars].reverse().find(b => b.trade_date < day || (b.trade_date === day && Number(fields.hour) >= 16)) ?? null;
}