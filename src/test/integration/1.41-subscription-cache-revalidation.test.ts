import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 回歸：訂閱門檻相關的 React Query 不得吃持久化快取。
 *
 * 事故：ken05316 續訂後，/app/journals 仍顯示「尚未訂閱任何實戰導師」，
 * 因為 `app-journals` 被寫入 localStorage（gcTime 24h）且 `refetchOnMount: false`，
 * 付款前的「無訂閱」結果永遠不再重驗。
 */
const FILES = [
  'src/pages/app/Journals.tsx',
  'src/pages/app/Signals.tsx',
  'src/pages/app/SignalDetail.tsx',
  'src/pages/app/_journalDetail/useJournalDetail.ts',
];

describe('subscription-gated queries revalidate on mount', () => {
  it.each(FILES)('%s 不得使用 refetchOnMount: false', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/refetchOnMount:\s*false/);
    expect(src).toMatch(/refetchOnMount:\s*'always'/);
  });

  it('登出／換帳號時會清掉持久化快取', () => {
    const auth = readFileSync('src/contexts/AuthContext.tsx', 'utf8');
    expect(auth).toContain('purgePersistedQueryCache');
    const qc = readFileSync('src/lib/queryClient.ts', 'utf8');
    expect(qc).toContain('export function purgePersistedQueryCache');
    expect(qc).toContain('removeItem(STORAGE_KEY)');
  });
});
