import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WeeklyLimitUpLeaderboard, type LeaderboardEntry } from '@/components/WeeklyLimitUpLeaderboard';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('WeeklyLimitUpLeaderboard', () => {
  it('renders empty-state message when entries is empty', () => {
    renderWithRouter(<WeeklyLimitUpLeaderboard entries={[]} />);
    expect(screen.getByText('本週尚無漲停命中紀錄')).toBeInTheDocument();
  });

  it('renders skeletons while loading', () => {
    const { container } = renderWithRouter(
      <WeeklyLimitUpLeaderboard entries={[]} isLoading />,
    );
    // Skeleton component renders animate-pulse divs
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders entries with their names and limit-up counts', () => {
    const entries: LeaderboardEntry[] = [
      {
        rank: 1,
        expertId: 'e1',
        expertSlug: 'alice',
        name: 'Alice',
        avatarUrl: '',
        limitUpCount: 5,
        winRate: 80,
        weeklyReturn: 12.3,
      },
      {
        rank: 2,
        expertId: 'e2',
        expertSlug: 'bob',
        name: 'Bob',
        avatarUrl: '',
        limitUpCount: 3,
        winRate: 60,
        weeklyReturn: -2.5,
      },
    ];
    renderWithRouter(<WeeklyLimitUpLeaderboard entries={entries} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('+12.3%')).toBeInTheDocument();
    expect(screen.getByText('-2.5%')).toBeInTheDocument();
  });

  it('uses custom weekLabel when provided', () => {
    renderWithRouter(<WeeklyLimitUpLeaderboard entries={[]} weekLabel="上週" />);
    expect(screen.getByText(/上週漲停王排行榜/)).toBeInTheDocument();
  });
});
