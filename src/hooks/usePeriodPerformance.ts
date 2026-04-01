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
 * Weekly view: 5-day windows within a month (1-5, 6-10, 11-15, 16-20, 21-end)
 * Label: "2026/03/01~03/05"
 */
function weeklyBucketLabel(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const lastDay = new Date(y, m + 1, 0).getDate();

  let startDay: number, endDay: number;
  if (d <= 5) { startDay = 1; endDay = 5; }
  else if (d <= 10) { startDay = 6; endDay = 10; }
  else if (d <= 15) { startDay = 11; endDay = 15; }
  else if (d <= 20) { startDay = 16; endDay = 20; }
  else { startDay = 21; endDay = lastDay; }

  const mm = String(m + 1).padStart(2, '0');
  const sd = String(startDay).padStart(2, '0');
  const ed = String(endDay).padStart(2, '0');
  return `${y}/${mm}/${sd}~${mm}/${ed}`;
}

/**
 * Monthly view: weeks within the month (W1-W5)
 * Label: "2026/03/W1"
 * Week boundaries: W1=days 1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-end
 */
function monthlyBucketLabel(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  let week: number;
  if (d <= 7) week = 1;
  else if (d <= 14) week = 2;
  else if (d <= 21) week = 3;
  else if (d <= 28) week = 4;
  else week = 5;

  const mm = String(m + 1).padStart(2, '0');
  return `${y}/${mm}/W${week}`;
}

/**
 * Yearly view: months as buckets
 * Label: "2026/03"
 */
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

      // Only return buckets with actual data, sorted
      const sortedKeys = Array.from(buckets.keys()).sort();

      return sortedKeys.map(label => {
        const stocks = buckets.get(label)!;
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
