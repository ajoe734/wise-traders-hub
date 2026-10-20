import { it, expect } from 'vitest';
import { selectBackfillQueue } from '../../../supabase/functions/_shared/marketDataStore';

it('歷史股價每輪最多40檔，即使呼叫端要求100檔', () => {
  const rows = Array.from({ length: 105 }, (_, i) => ({ symbol: String(1000 + i), state: 'pending' }));
  expect(selectBackfillQueue(rows, 100)).toHaveLength(40);
});