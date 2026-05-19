/**
 * useMyTradeRecordHoldings — 從 trade_records 取得使用者目前未平倉部位
 *
 * 命名澄清（holdings audit 2026-05 / C 批 M7）：
 * 專案內有三套 holdings hooks／stores，請依用途擇一：
 *   1. `useMyTradeRecordHoldings`（本檔，React Query）— 訂閱使用者 trade_records 表，status='open'
 *   2. `useHoldingsStore`（Zustand）— `src/checkup/stores/holdingsStore.js`，會員版 /checkup 全域狀態
 *   3. （已刪除）`src/checkup/hooks/useHoldings.js` 本地 state 版 — orphan，於 C 批移除
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useMyHoldings(expertId?: string) {
  return useQuery({
    queryKey: ['holdings', expertId],
    queryFn: async () => {
      let query = supabase
        .from('trade_records')
        .select('*')
        .eq('status', 'open');
      if (expertId) {
        query = query.eq('expert_id', expertId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}
