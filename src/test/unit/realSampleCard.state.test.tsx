/**
 * Contract: RealSampleCard 三態，禁止假骨架 fallback。
 * - loading：aria-busy skeleton
 * - error：資料暫時無法取得
 * - empty（RPC 成功但無已核准 row）：目前尚無公開範例
 * - ready：只顯示真實 snapshot 文字
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fs from 'node:fs';

const q = vi.hoisted(() => ({ value: { data: undefined as any, isLoading: true, isError: false } }));
vi.mock('@/hooks/useExpertPublicSample', () => ({
  useExpertPublicSample: () => q.value,
}));
vi.mock('@/lib/analytics/events', () => ({ track: vi.fn() }));

import { RealSampleCard } from '@/pages/_expert/RealSampleCard';

describe('RealSampleCard states', () => {
  beforeEach(() => {
    cleanup();
    q.value = { data: undefined, isLoading: true, isError: false };
  });

  it('loading renders aria-busy skeleton only', () => {
    const { getByTestId, queryByText } = render(<RealSampleCard expertSlug="x" />);
    expect(getByTestId('real-sample-loading').getAttribute('aria-busy')).toBe('true');
    expect(queryByText('目前尚無公開範例')).toBeNull();
  });

  it('error renders the unavailable label', () => {
    q.value = { data: undefined, isLoading: false, isError: true };
    const { getByText, queryByTestId } = render(<RealSampleCard expertSlug="x" />);
    expect(getByText('資料暫時無法取得')).toBeTruthy();
    expect(queryByTestId('real-sample')).toBeNull();
  });

  it('empty renders the exact empty copy and no fake structure fields', () => {
    q.value = { data: null, isLoading: false, isError: false };
    const { getByText, queryByText, getByTestId } = render(<RealSampleCard expertSlug="x" />);
    expect(getByTestId('real-sample-empty')).toBeTruthy();
    expect(getByText('目前尚無公開範例')).toBeTruthy();
    for (const fake of ['當週操作紀錄', '判斷依據', '結果對照', '下週研究清單', '觀察條件', '風險情境', '訂閱後可見']) {
      expect(queryByText(fake)).toBeNull();
    }
  });

  it('ready renders the approved snapshot text', () => {
    q.value = {
      data: {
        expertName: 'A', expertSlug: 'x', weekStart: '2026-07-20',
        sections: [{ key: 'overall_summary', label: '當週復盤', text: '真實內容片段' }],
        maskLevel: 'M1', updatedAt: '2026-08-01T00:00:00Z',
      },
      isLoading: false, isError: false,
    };
    const { getByText, getByTestId } = render(<RealSampleCard expertSlug="x" />);
    expect(getByTestId('real-sample')).toBeTruthy();
    expect(getByText('真實內容片段')).toBeTruthy();
  });

  it('source has no skeleton fallback and SampleStructureCard is deleted', () => {
    const src = fs.readFileSync('src/pages/_expert/RealSampleCard.tsx', 'utf8');
    expect(src).not.toContain('SampleStructureCard');
    expect(fs.existsSync('src/pages/_expert/SampleStructureCard.tsx')).toBe(false);
  });
});
