import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformanceReviewNotice, ReviewPlaceholder } from './PerformanceReviewNotice';
import { resolveProjectionStatus } from '@/contracts/publicProjection';

describe('PerformanceReviewNotice', () => {
  it('renders 資料檢核中 + 該區間不納入績效 for a 6515-style manual review', () => {
    render(<PerformanceReviewNotice status={resolveProjectionStatus({ manualReview: true })} />);
    expect(screen.getByText('資料檢核中')).toBeInTheDocument();
    expect(screen.getByText('該區間不納入績效')).toBeInTheDocument();
  });

  it.each(['incomplete', 'withheld'] as const)('renders for %s scopes', (state) => {
    render(<PerformanceReviewNotice status={resolveProjectionStatus({ state })} />);
    expect(screen.getByTestId('performance-review-notice')).toBeInTheDocument();
  });

  it('renders nothing when the scope is ready', () => {
    const { container } = render(
      <PerformanceReviewNotice status={resolveProjectionStatus({ state: 'ready' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no projection or the read failed', () => {
    const a = render(<PerformanceReviewNotice status={resolveProjectionStatus({ absent: true })} />);
    expect(a.container).toBeEmptyDOMElement();
    const b = render(<PerformanceReviewNotice status={resolveProjectionStatus({ failed: true })} />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it('never shows a number, a hashed key or an internal reason', () => {
    render(
      <PerformanceReviewNotice
        status={resolveProjectionStatus({ manualReview: true, state: 'multiple_apply' })}
      />,
    );
    const text = screen.getByTestId('performance-review-notice').textContent ?? '';
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('multiple_apply');
  });

  it('the inline placeholder shows the review copy instead of a value', () => {
    render(<ReviewPlaceholder />);
    expect(screen.getByTestId('review-placeholder')).toHaveTextContent('資料檢核中');
  });
});
