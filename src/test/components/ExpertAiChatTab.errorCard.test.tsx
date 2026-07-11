import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock hook 前必須在 import 元件之前
const retry = vi.fn();
const sendMessage = vi.fn();
const clearConversation = vi.fn();
const refreshQuota = vi.fn();

const hookState = {
  messages: [] as any[],
  sendMessage,
  status: 'error' as const,
  loadingHistory: false,
  loadError: null as string | null,
  clearConversation,
  error: new Error('AI 對話串流失敗（errorId: err_lz9x_abc123）：upstream rate limit'),
  quota: { limit: 20, used: 20, remaining: 20, resets_at: new Date(Date.now() + 3600_000).toISOString() },
  quotaError: null as string | null,
  refreshQuota,
  canRetry: true,
  retry,
  errorId: 'err_lz9x_abc123',
};

vi.mock('@/pages/_expertAiChat/useExpertAiChat', () => ({
  useExpertAiChat: () => hookState,
}));

// react-markdown 有 ESM 相依，測試環境 mock 掉即可
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { ExpertAiChatTab } from '@/pages/_expertAiChat/ExpertAiChatTab';

function renderTab() {
  return render(
    <MemoryRouter>
      <ExpertAiChatTab expertId="e1" expertName="王小明" isSubscribed={true} />
    </MemoryRouter>,
  );
}

describe('ExpertAiChatTab — 串流錯誤卡片', () => {
  beforeEach(() => {
    retry.mockReset();
    sendMessage.mockReset();
  });

  it('顯示錯誤卡片、errorId 與已自動重試提示', () => {
    renderTab();
    expect(screen.getByText('AI 對話發生錯誤')).toBeInTheDocument();
    expect(screen.getByText(/upstream rate limit/)).toBeInTheDocument();
    expect(screen.getByText(/已自動重試一次仍失敗/)).toBeInTheDocument();
    expect(screen.getByText(/errorId:\s*err_lz9x_abc123/)).toBeInTheDocument();
  });

  it('點擊「重試」呼叫 retry()', () => {
    renderTab();
    const btn = screen.getByRole('button', { name: /重試/ });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('errorId 節點使用 select-all 讓使用者直接複製回報', () => {
    renderTab();
    const node = screen.getByText(/errorId:\s*err_lz9x_abc123/);
    expect(node.className).toMatch(/select-all/);
    expect(node.className).toMatch(/font-mono/);
  });
});
