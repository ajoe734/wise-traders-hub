import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, startOfMonth, startOfYear, addMonths, addWeeks, addYears, endOfMonth, isBefore, isAfter, getISOWeek } from 'date-fns';

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

function bucketKey(date: Date, period: ViewPeriod): string {
  switch (period) {
    case 'yearly':
      return format(date, 'yyyy');
    case 'monthly':
      return format(date, 'yyyy/MM');
    case 'weekly': {
      const ws = startOfWeek(date, { weekStartsOn: 1 });
      return `W${getISOWeek(ws)}`;
    }
  }
}

/** Generate all expected bucket keys for a given period scope */
function generateAllKeys(period: ViewPeriod, firstDate?: Date): string[] {
  const now = new Date();
  const keys: string[] = [];

  switch (period) {
    case 'yearly': {
      // From first trade year to current year
      const startYear = firstDate ? firstDate.getFullYear() : now.getFullYear();
      for (let y = startYear; y <= now.getFullYear(); y++) {
        keys.push(String(y));
      }
      break;
    }
    case 'monthly': {
      // All months of current year up to current month
      const yearStart = startOfYear(now);
      let cursor = yearStart;
      while (!isAfter(cursor, now)) {
        keys.push(format(cursor, 'yyyy/MM'));
        cursor = addMonths(cursor, 1);
      }
      break;
    }
    case 'weekly': {
      // All weeks of current month up to current week
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      let cursor = startOfWeek(monthStart, { weekStartsOn: 1 });
      while (!isAfter(cursor, now)) {
        // Only include weeks that overlap with this month
        if (!isAfter(monthEnd, cursor) === false) {
          keys.push(format(cursor, 'MM/dd'));
        }
        cursor = addWeeks(cursor, 1);
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
      if (!data || data.length === 0) {
        // Still show empty period slots
        const allKeys = generateAllKeys(period);
        return allKeys.map(label => ({ label, returnPct: 0, stocks: [] }));
      }

      // Find earliest trade date for yearly range
      const firstTradeDate = data[0].exit_date ? new Date(data[0].exit_date) : new Date();

      // Group into buckets
      const buckets = new Map<string, StockTrade[]>();

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

      // Generate all expected keys and fill gaps with empty buckets
      const allKeys = generateAllKeys(period, firstTradeDate);

      const result: PeriodBucket[] = allKeys.map(label => {
        const stocks = buckets.get(label) || [];
        if (stocks.length === 0) {
          return { label, returnPct: 0, stocks: [] };
        }
        let equity = 1;
        for (const s of stocks) {
          equity *= (1 + s.returnPct / 100);
        }
        const returnPct = (equity - 1) * 100;

        const sorted = [...stocks].sort((a, b) => b.returnPct - a.returnPct);
        const topStock = sorted[0] ? { symbol: sorted[0].symbol, name: sorted[0].name, returnPct: sorted[0].returnPct } : undefined;
        const bottomStock = sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, name: sorted[sorted.length - 1].name, returnPct: sorted[sorted.length - 1].returnPct } : undefined;

        return { label, returnPct: Math.round(returnPct * 100) / 100, topStock, bottomStock, stocks };
      });

      return result;
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });
}
