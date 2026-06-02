/**
 * useMyTradeRecordHoldings — 從 trade_records 取得使用者目前未平倉部位
 *
 * 命名澄清（holdings audit 2026-05 / C 批 M7）：
 * 專案內有三套 holdings hooks／stores，請依用途擇一：
 *   1. `useMyTradeRecordHoldings`（本檔，React Query）— 訂閱使用者 trade_records 表，status='open'
 *   2. `useHoldingsStore`（Zustand）— `src/checkup/stores/holdingsStore.js`，會員版 /checkup 全域狀態
 *   3. （已刪除）`src/checkup/hooks/useHoldings.js` 本地 state 版 — orphan，於 C 批移除
 *
 * C1（holdings audit 2026-06）：強制 expertId 守衛。
 *   trade_records 沒有 user_id 欄位，只有 expert_id；
 *   若呼叫端忘了帶 expertId，原本會回傳「全站所有 active expert 的 open 部位」（RLS 允許），
 *   屬於跨身分資料外洩。現在強制 `enabled: !!expertId`，沒帶 ID → 不查，回傳空陣列。
 *   後台 (company/admin) 帶明確 expertId 時行為不變。
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useMyHoldings(expertId?: string) {
  return useQuery({
    queryKey: ['holdings', expertId ?? null],
    queryFn: async () => {
      if (!expertId) return [];
      const { data, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('status', 'open')
        .eq('expert_id', expertId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!expertId,
    staleTime: 30_000,
  });
}
