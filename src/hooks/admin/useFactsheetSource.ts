import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { FactsheetExpert, FactsheetTrade } from '@/lib/performance/factsheet';

/**
 * Factsheet 專用資料讀取：一次撈齊 expert 設定與**全部**交易紀錄（不做 period 篩選，
 * 期間切換在前端純函式處理，避免同一份 PDF 內出現不同 query 的口徑漂移）。
 */
export function useFactsheetSource(expertSlug: string | undefined) {
  return useQuery({
    queryKey: ['factsheet-source', expertSlug],
    enabled: !!expertSlug,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: expert, error: e1 } = await supabase
        .from('experts')
        .select('id, slug, name, role, starting_capital, currency, asset_class, strategy_summary, description, style_tags, markets')
        .eq('slug', expertSlug!)
        .maybeSingle();
      if (e1) throw e1;
      if (!expert) throw new Error('查無此專家');

      const { data: trades, error: e2 } = await supabase
        .from('trade_records')
        .select('id, instrument, entry_price, exit_price, current_price, quantity, entry_date, exit_date, pnl_percent, status')
        .eq('expert_id', expert.id)
        .order('exit_date', { ascending: true });
      if (e2) throw e2;

      return {
        expert: expert as unknown as FactsheetExpert,
        trades: (trades ?? []) as unknown as FactsheetTrade[],
      };
    },
  });
}
