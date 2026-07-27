import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeepWarmWavesCard } from '@/pages/company/_bsr/KeepWarmWavesCard';

const mockRows: any[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        gte: () => ({
          order: () => ({
            limit: async () => ({ data: mockRows, error: null }),
          }),
        }),
      }),
    }),
  },
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('KeepWarmWavesCard', () => {
  beforeEach(() => {
    mockRows.length = 0;
  });

  it('顯示空狀態當沒有資料', async () => {
    wrap(<KeepWarmWavesCard />);
    await waitFor(() =>
      expect(screen.getByText(/尚無資料/)).toBeInTheDocument(),
    );
  });

  it('每個 trade_date × wave 取最新一筆並顯示封盤 badge', async () => {
    const t1 = new Date(Date.now() - 3600_000).toISOString();
    const t2 = new Date(Date.now() - 1800_000).toISOString();
    const t3 = new Date(Date.now() - 600_000).toISOString();
    mockRows.push(
      {
        id: '1', trade_date: '2026-07-25', wave: 1, status: 'partial',
        sealed: false, sealed_by_lane: null,
        coverage_stocks: 100, coverage_brokers: 20,
        fallback_used_count: 3, duration_ms: 1200, error: null,
        started_at: t1,
      },
      {
        id: '3', trade_date: '2026-07-25', wave: 2, status: 'error',
        sealed: false, sealed_by_lane: null,
        coverage_stocks: 0, coverage_brokers: 0,
        fallback_used_count: 0, duration_ms: 900,
        error: 'reconcile timeout',
        started_at: t2,
      },
      {
        id: '2', trade_date: '2026-07-25', wave: 1, status: 'sealed',
        sealed: true, sealed_by_lane: 'A',
        coverage_stocks: 500, coverage_brokers: 90,
        fallback_used_count: 7, duration_ms: 2500, error: null,
        started_at: t3,
      },
    );
    wrap(<KeepWarmWavesCard />);
    await waitFor(() =>
      expect(screen.getByText('已封盤')).toBeInTheDocument(),
    );
    expect(screen.getByText('失敗')).toBeInTheDocument();
    expect(screen.getByText(/reconcile timeout/)).toBeInTheDocument();
    // wave 3 未執行
    expect(screen.getAllByText('未執行').length).toBeGreaterThan(0);
    // Fallback 顯示最新一筆（sealed 那筆 7 檔）
    expect(screen.getByText('7 檔')).toBeInTheDocument();
    // 封盤 lane
    expect(screen.getByText(/封盤 lane：A/)).toBeInTheDocument();
  });

  it('聚合摘要正確計算封盤率與錯誤率', async () => {
    const now = new Date().toISOString();
    mockRows.push(
      { id: 'a', trade_date: '2026-07-25', wave: 1, status: 'sealed', sealed: true, sealed_by_lane: 'A', coverage_stocks: 1, coverage_brokers: 1, fallback_used_count: 0, duration_ms: 1000, error: null, started_at: now },
      { id: 'b', trade_date: '2026-07-25', wave: 2, status: 'sealed', sealed: true, sealed_by_lane: 'A', coverage_stocks: 1, coverage_brokers: 1, fallback_used_count: 0, duration_ms: 3000, error: null, started_at: now },
      { id: 'c', trade_date: '2026-07-24', wave: 1, status: 'error', sealed: false, sealed_by_lane: null, coverage_stocks: 0, coverage_brokers: 0, fallback_used_count: 0, duration_ms: 500, error: 'x', started_at: now },
      { id: 'd', trade_date: '2026-07-24', wave: 2, status: 'partial', sealed: false, sealed_by_lane: null, coverage_stocks: 5, coverage_brokers: 5, fallback_used_count: 2, duration_ms: 1500, error: null, started_at: now },
    );
    wrap(<KeepWarmWavesCard />);
    await waitFor(() => expect(screen.getAllByText('4').length).toBeGreaterThan(0));
    expect(screen.getByText('50.0%')).toBeInTheDocument(); // sealed 2/4
    expect(screen.getByText('25.0%')).toBeInTheDocument(); // error 1/4
    // 平均延遲 (1000+3000+500+1500)/4 = 1500ms -> 1.50s（可能與 wave 儲存格重複，故用 getAllByText）
    expect(screen.getAllByText('1.50s').length).toBeGreaterThan(0);
    // fallback total = 0+0+0+2 = 2
    expect(screen.getByText(/fallback 用 2 檔次/)).toBeInTheDocument();
  });
});
