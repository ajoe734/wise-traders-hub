import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  startOfYear, endOfYear, startOfMonth, endOfMonth,
  addMonths, addWeeks, isAfter, isBefore, format,
  startOfWeek, getDay
} from 'date-fns';

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
 * Determine which week-of-month (1-5) a date falls in.
 * Week 1 starts on the first Monday of the month (or the 1st if it's Mon).
 * Days before the first Monday are in W1.
 */
function weekOfMonth(date: Date): number {
  const dayOfMonth = date.getDate();
  // Find what day-of-week the 1st is (0=Sun, 1=Mon, ...)
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDayOfWeek = firstOfMonth.getDay(); // 0=Sun
  // Offset so Monday=0
  const offset = (firstDayOfWeek === 0) ? 6 : firstDayOfWeek - 1;
  const week = Math.ceil((dayOfMonth + offset) / 7);
  return Math.min(week, 5);
}

/**
 * Build a bucket key for a given trade exit date.
 * Weekly:  "2026_01_W1"
 * Monthly: "2026/01"
 * Yearly:  "2026"
 */
function bucketKey(date: Date, period: ViewPeriod): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  switch (period) {
    case 'yearly':
      return String(yyyy);
    case 'monthly':
      return `${yyyy}/${mm}`;
    case 'weekly':
      return `${yyyy}_${mm}_W${weekOfMonth(date)}`;
  }
}

/**
 * Generate all expected bucket keys for display on X-axis.
 * For weekly: show current month's weeks + any past months that have data.
 * For monthly: show all months of current year up to now.
 * For yearly: rolling 5-year window.
 */
function generateAllKeys(period: ViewPeriod, firstTradeDate?: Date, existingKeys?: Set<string>): string[] {
  const now = new Date();
  const keys: string[] = [];

  switch (period) {
    case 'yearly': {
      const endYear = now.getFullYear();
      const startYear = firstTradeDate
        ? Math.max(firstTradeDate.getFullYear(), endYear - 4)
        : endYear - 4;
      for (let y = startYear; y <= endYear; y++) {
        keys.push(String(y));
      }
      break;
    }
    case 'monthly': {
      const year = now.getFullYear();
      // Include months from first trade if same year
      const startMonth = firstTradeDate && firstTradeDate.getFullYear() === year
        ? firstTradeDate.getMonth() : 0;
      for (let m = startMonth; m <= now.getMonth(); m++) {
        keys.push(`${year}/${String(m + 1).padStart(2, '0')}`);
      }
      break;
    }
    case 'weekly': {
      // Collect all months that have data, plus current month
      const monthsToShow = new Set<string>();
      const currYyyy = now.getFullYear();
      const currMm = String(now.getMonth() + 1).padStart(2, '0');

      // Add months from existing data keys (format: YYYY_MM_WN)
      if (existingKeys) {
        for (const k of existingKeys) {
          const parts = k.split('_W');
          if (parts.length === 2) {
            monthsToShow.add(parts[0]); // "YYYY_MM"
          }
        }
      }

      // Sort months and generate W1-W5 for each
      const sortedMonths = Array.from(monthsToShow).sort();
      for (const ym of sortedMonths) {
        const [yStr, mStr] = ym.split('_');
        const y = parseInt(yStr);
        const m = parseInt(mStr);
        const isCurrentMonth = y === currYyyy && mStr === currMm;
        const maxWeek = isCurrentMonth ? weekOfMonth(now) : 5;
        for (let w = 1; w <= Math.min(maxWeek, 5); w++) {
          keys.push(`${ym}_W${w}`);
        }
      }
      break;
    }
  }
  return keys;
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

      const firstTradeDate = data?.[0]?.exit_date ? new Date(data[0].exit_date) : undefined;

      // Group trades into buckets
      const buckets = new Map<string, StockTrade[]>();

      if (data) {
        for (const tr of data) {
          const exitDate = new Date(tr.exit_date!);
          const key = bucketKey(exitDate, period);
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

          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(stock);
        }
      }

      // Generate all expected keys and fill gaps
      const allKeys = generateAllKeys(period, firstTradeDate, new Set(buckets.keys()));

      return allKeys.map(label => {
        const stocks = buckets.get(label) || [];
        if (stocks.length === 0) {
          return { label, returnPct: 0, stocks: [] };
        }
        // Simple sum
        const returnPct = stocks.reduce((sum, s) => sum + s.returnPct, 0);
        const sorted = [...stocks].sort((a, b) => b.returnPct - a.returnPct);
        const topStock = sorted[0] ? { symbol: sorted[0].symbol, name: sorted[0].name, returnPct: sorted[0].returnPct } : undefined;
        const bottomStock = sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, name: sorted[sorted.length - 1].name, returnPct: sorted[sorted.length - 1].returnPct } : undefined;

        return { label, returnPct: Math.round(returnPct * 100) / 100, topStock, bottomStock, stocks };
      });
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });
}
