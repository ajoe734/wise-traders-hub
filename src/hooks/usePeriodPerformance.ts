import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StockTrade {
  symbol: string;
  name: string;
  returnPct: number;
  entryDate: string;
  holdingDays: number;
  entryPrice: number;
  currentPrice: number;
  contributionNote: string;
}

export interface PeriodBucket {
  label: string;
  returnPct: number;
  topStock?: { symbol: string; name: string; returnPct: number };
  bottomStock?: { symbol: string; name: string; returnPct: number };
  stocks: StockTrade[];
}

type ViewPeriod = 'yearly' | 'monthly' | 'weekly';

/**
 * Get Monday of the week containing the given date
 */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the 5 weekdays (Mon-Fri) of the current week
 */
/**
 * Get trading days (skip Sat/Sun) from a start date to today, sorted ascending.
 */
function getTradingDaysFromTo(start: Date, end: Date): string[] {
  const days: string[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const endTime = end.getTime();
  while (d.getTime() <= endTime) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.push(`${d.getFullYear()}/${mm}/${dd}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/**
 * Get the latest 5 trading days ending at today (skip Sat/Sun), sorted ascending.
 */
function getWeeklyTradingDays(): string[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days: string[] = [];
  const d = new Date(now);
  while (days.length < 5) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.unshift(`${d.getFullYear()}/${mm}/${dd}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return days;
}

/**
 * Get trading days from 1st of previous month to today (skip Sat/Sun).
 */
function getMonthlyTradingDays(): string[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // 1st of previous month
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return getTradingDaysFromTo(start, now);
}

/** Weekly: each trading day is its own point, label "MM/DD" */
function weeklyBucketLabel(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}/${mm}/${dd}`;
}

/** Monthly: weeks W1-W5, label "YYYY/MM/W#" */
function monthlyBucketLabel(date: Date): string {
  const y = date.getFullYear();
  const d = date.getDate();
  const week = d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : d <= 28 ? 4 : 5;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}/${mm}/W${week}`;
}

/** Yearly: months, label "YYYY/MM" */
function yearlyBucketLabel(date: Date): string {
  const y = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}/${mm}`;
}

function getBucketLabel(date: Date, period: ViewPeriod): string {
  switch (period) {
    case 'weekly': return weeklyBucketLabel(date);
    case 'monthly': return monthlyBucketLabel(date);
    case 'yearly': return yearlyBucketLabel(date);
  }
}

export function usePeriodPerformance(expertId: string | undefined, period: ViewPeriod) {
  return useQuery({
    queryKey: ['period-performance', expertId, period],
    queryFn: async (): Promise<PeriodBucket[]> => {
      if (!expertId) return [];

      const { data, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('expert_id', expertId)
        .in('status', ['closed', 'stopped'])
        .not('pnl_percent', 'is', null)
        .order('exit_date', { ascending: true });

      if (error) throw error;

      // Group trades into buckets
      const buckets = new Map<string, StockTrade[]>();

      if (data) {
        for (const tr of data) {
          if (!tr.exit_date) continue;
          const exitDate = new Date(tr.exit_date);
          const label = getBucketLabel(exitDate, period);
          const entryDate = tr.entry_date ? new Date(tr.entry_date) : exitDate;
          const holdingDays = Math.max(1, Math.round((exitDate.getTime() - entryDate.getTime()) / 86400000));

          const stock: StockTrade = {
            symbol: tr.instrument,
            name: tr.instrument,
            returnPct: Number(tr.pnl_percent),
            entryDate: tr.entry_date || tr.created_at,
            holdingDays,
            entryPrice: Number(tr.entry_price || 0),
            currentPrice: Number(tr.exit_price || tr.current_price || 0),
            contributionNote: `本期報酬 ${Number(tr.pnl_percent) >= 0 ? '+' : ''}${Number(tr.pnl_percent).toFixed(2)}%`,
          };

          if (!buckets.has(label)) buckets.set(label, []);
          buckets.get(label)!.push(stock);
        }
      }

      // Filter buckets to current scope only
      const now = new Date();
      const currYear = now.getFullYear();
      const currMonth = String(now.getMonth() + 1).padStart(2, '0');

      let filteredKeys = Array.from(buckets.keys()).sort();

      if (period === 'weekly') {
        // Always show all 5 weekdays (Mon-Fri) of the current week
        const weekdays = getCurrentWeekdays();
        return weekdays.map(key => {
          const parts = key.split('/');
          const displayLabel = `${parts[0]}/${parts[1]}/${parts[2]}`;
          const stocks = buckets.get(key) || [];
          const returnPct = stocks.reduce((sum, s) => sum + s.returnPct, 0);
          const sorted = [...stocks].sort((a, b) => b.returnPct - a.returnPct);
          const topStock = sorted[0] ? { symbol: sorted[0].symbol, name: sorted[0].name, returnPct: sorted[0].returnPct } : undefined;
          const bottomStock = sorted.length ? { symbol: sorted[sorted.length - 1].symbol, name: sorted[sorted.length - 1].name, returnPct: sorted[sorted.length - 1].returnPct } : undefined;
          return { label: displayLabel, returnPct: Math.round(returnPct * 100) / 100, topStock, bottomStock, stocks };
        });
      }
      
      if (period === 'monthly') {
        const prefix = `${currYear}/`;
        filteredKeys = filteredKeys.filter(k => k.startsWith(prefix));
      } else {
        const minYear = currYear - 4;
        filteredKeys = filteredKeys.filter(k => {
          const y = parseInt(k.split('/')[0], 10);
          return y >= minYear && y <= currYear;
        });
      }

      return filteredKeys.map(key => {
        const stocks = buckets.get(key)!;
        const returnPct = stocks.reduce((sum, s) => sum + s.returnPct, 0);
        const sorted = [...stocks].sort((a, b) => b.returnPct - a.returnPct);
        const topStock = sorted[0] ? { symbol: sorted[0].symbol, name: sorted[0].name, returnPct: sorted[0].returnPct } : undefined;
        const bottomStock = sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, name: sorted[sorted.length - 1].name, returnPct: sorted[sorted.length - 1].returnPct } : undefined;
        return { label: key, returnPct: Math.round(returnPct * 100) / 100, topStock, bottomStock, stocks };
      });
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });
}
