import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleBadge } from '@/components/RoleBadge';

describe('RoleBadge', () => {
  it('renders advisor label for "advisor" role', () => {
    render(<RoleBadge role="advisor" />);
    expect(screen.getByText('投顧分析師')).toBeInTheDocument();
  });

  it('renders mentor label for "mentor" role', () => {
    render(<RoleBadge role="mentor" />);
    expect(screen.getByText('實戰導師')).toBeInTheDocument();
  });

  it('applies size classes for sm', () => {
    const { container } = render(<RoleBadge role="advisor" size="sm" />);
    expect(container.querySelector('.text-\\[10px\\]')).toBeInTheDocument();
  });

  it('applies size classes for lg', () => {
    const { container } = render(<RoleBadge role="mentor" size="lg" />);
    expect(container.querySelector('.text-sm')).toBeInTheDocument();
  });
});
