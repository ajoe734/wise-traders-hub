import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpertFetchError } from '@/components/ExpertFetchError';

/**
 * 驗證 ExpertFetchError 的 onBack 行為：
 *  - 未提供 onBack 時，不應渲染返回按鈕（避免空 callback 觸發 ErrorBoundary）。
 *  - 提供 onBack 時，按鈕應渲染並呼叫該 callback。
 *  - render 過程不可拋例外（會被 AppErrorBoundary 接住）。
 */
describe('ExpertFetchError onBack 渲染契約', () => {
  it('未提供 onBack → 不渲染返回按鈕，只渲染重新載入', () => {
    render(<ExpertFetchError onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: '重新載入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /返回/ })).not.toBeInTheDocument();
    // role=alert 容器仍正常出現，代表沒被 ErrorBoundary 攔截
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('提供 onBack → 渲染返回按鈕並呼叫 callback', async () => {
    const onBack = vi.fn();
    render(
      <ExpertFetchError onRetry={() => {}} onBack={onBack} backLabel="返回戰情室" />,
    );
    const btn = screen.getByRole('button', { name: '返回戰情室' });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('inline variant 從不渲染返回按鈕，即使傳了 onBack', () => {
    render(
      <ExpertFetchError variant="inline" onRetry={() => {}} onBack={() => {}} backLabel="返回" />,
    );
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });
});
