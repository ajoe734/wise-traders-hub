import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriptionTimeline, type TimelineSegment } from '@/components/SubscriptionTimeline';

const seg = (over: Partial<TimelineSegment>): TimelineSegment => ({
  id: 's1',
  plan_name: '修煉派',
  started_at: '2026-06-10T00:00:00Z',
  expires_at: '2026-07-10T00:00:00Z',
  status: 'expired',
  canceled_at: null,
  is_currently_active: false,
  ...over,
});

describe('SubscriptionTimeline', () => {
  it('沒有 segments 時不 render', () => {
    const { container } = render(<SubscriptionTimeline segments={[]} expertName="X" />);
    expect(container.firstChild).toBeNull();
  });

  it('顯示老師名 + 日期範圍 + 圖例', () => {
    render(
      <SubscriptionTimeline
        segments={[seg({}), seg({ id: 's2', started_at: '2026-07-14T00:00:00Z', expires_at: '2026-08-14T00:00:00Z', status: 'active', is_currently_active: true })]}
        expertName="彥愷"
      />,
    );
    expect(screen.getByText(/彥愷｜訂閱有效期間/)).toBeInTheDocument();
    // active + expired 圖例（可能同時出現在手機 badge 與圖例）
    expect(screen.getAllByText('進行中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已過期').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);
    // 週記回溯圖例
    expect(screen.getByText(/週記 ±7 天/)).toBeInTheDocument();
  });

  it('多段之間有空窗會顯示天數', () => {
    render(
      <SubscriptionTimeline
        segments={[
          seg({ id: 's1', started_at: '2026-06-10T00:00:00Z', expires_at: '2026-07-10T00:00:00Z' }),
          seg({ id: 's2', started_at: '2026-07-14T00:00:00Z', expires_at: '2026-08-14T00:00:00Z', status: 'active', is_currently_active: true }),
        ]}
        expertName="彥愷"
      />,
    );
    // 空窗 4 天（7/10 → 7/14）
    expect(screen.getAllByText(/空窗 4 天/).length).toBeGreaterThan(0);
  });

  it('showMentorLookback=false 不顯示 7 天回溯圖例', () => {
    render(
      <SubscriptionTimeline
        segments={[seg({})]}
        expertName="X"
        showMentorLookback={false}
      />,
    );
    expect(screen.queryByText(/週記 ±7 天/)).not.toBeInTheDocument();
  });

  it('a11y label 含每段狀態', () => {
    render(
      <SubscriptionTimeline
        segments={[seg({ id: 's1' }), seg({ id: 's2', started_at: '2026-07-14T00:00:00Z', expires_at: '2026-08-14T00:00:00Z', status: 'active', is_currently_active: true })]}
        expertName="彥愷"
      />,
    );
    const section = document.querySelector('[aria-label*="彥愷 訂閱時間軸"]');
    expect(section).toBeTruthy();
    const label = section!.getAttribute('aria-label')!;
    expect(label).toMatch(/2026\/06\/10.*已過期/);
    expect(label).toMatch(/2026\/07\/14.*進行中/);
  });

  it('canceled_at 有值時 a11y 顯示已取消', () => {
    render(
      <SubscriptionTimeline
        segments={[seg({ canceled_at: '2026-06-20T00:00:00Z' })]}
        expertName="X"
      />,
    );
    const section = document.querySelector('[aria-label*="訂閱時間軸"]');
    expect(section!.getAttribute('aria-label')).toMatch(/已取消/);
  });

  it('highlightAt 落在區間內時顯示本篇提示（手機版）', () => {
    render(
      <SubscriptionTimeline
        segments={[seg({ id: 's1', status: 'active', is_currently_active: true, expires_at: '2026-12-31T00:00:00Z' })]}
        expertName="X"
        highlightAt={new Date('2026-06-20T00:00:00Z')}
      />,
    );
    expect(screen.getAllByText(/本篇週記發布於 2026\/06\/20/).length).toBeGreaterThan(0);
  });
});
