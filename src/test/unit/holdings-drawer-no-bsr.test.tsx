/**
 * 持倉抽屜不得再出現「關鍵分點／BSR」surface。
 *
 * 需求（使用者明確更正）：抽屜中的關鍵分點整個取消——標題、1/5/10 日切換、
 * 狀態列、補資料提示、最後成功日期、展開內容與其佔用空間全部移除；
 * 但後端管線與其他 surface（harness 等）的共用能力不得刪除。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import React from 'react';

const payload = {
  as_of: '2026-09-18',
  bsr_as_of: '2026-09-18',
  bsr_low_quality: true,
  bsr_broker_count: 27,
  bsr_low_quality_threshold: 5,
  institutional: { d1: { foreign_net: 1000, trust_net: 0, dealer_net: 0, days_covered: 1 } },
  readiness: { bsr_concentration: { '5': { have: 27, need: 5, state: 'ready' } } },
  bsr: { d5: { top_buy: [{ broker_id: '1', name: '甲券商', net: 100 }], top_sell: [], concentration_ratio: 80 } },
  bsr_last_failure: { last_successful_as_of: '2026-09-17', error_code: 'finmind_error' },
  series: { institutional_daily: [], bsr_concentration: [] },
};

vi.mock('@/checkup/hooks/useChipsLifecycle', () => ({
  useChipsLifecycle: () => ({
    data: payload,
    loading: false,
    error: null,
    fetchedAt: Date.now(),
    ageLabel: '剛剛',
    fetchedAtClock: '12:00',
    online: true,
    stale: false,
    refetch: vi.fn(),
    autoState: 'idle',
    nextAutoAt: null,
    ui: { state: 'ok', reason: '' },
    facts: { instDays: 60, bsrDays: 27, sparse: false, terminalUnavailable: false },
    backfilling: false,
    backfillPhase: 'idle',
    requestBackfill: vi.fn(),
  }),
}));

const WB = { ink: '#292520', inkSub: '#5a5148', inkMute: '#9a9088', hair: '#e6e1d8', paper: '#F5F3EF' };

describe('持倉抽屜移除關鍵分點 surface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('HoldingsDetailPanel 必須以 showBsr={false} 掛載 ChipsSection', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/checkup/components/freecheckup/HoldingsDetailPanel.tsx'),
      'utf8',
    );
    expect(src).toMatch(/<ChipsSection[^>]*showBsr=\{false\}/);
  });

  it('showBsr=false 時不渲染任何分點元素與文字', async () => {
    const { default: ChipsSection } = await import('@/checkup/components/freecheckup/ChipsSection');
    const { container } = render(<ChipsSection WB={WB} stockCode="2330" showBsr={false} />);
    const html = container.innerHTML;

    for (const id of [
      'chips-bsr-quality-badge', 'chips-bsr', 'chips-bsr-partial', 'chips-bsr-window-switch',
      'chips-bsr-window-d1', 'chips-bsr-window-d5', 'chips-bsr-window-d10',
      'chips-bsr-as-of', 'chips-bsr-status', 'chips-bsr-fallback-note', 'chips-bsr-fallback-hint',
      'chips-bsr-missing', 'chips-bsr-low-quality-badge', 'chips-seg-bsr',
    ]) {
      expect(screen.queryByTestId(id), `${id} 不得出現在持倉抽屜`).toBeNull();
    }
    for (const text of ['關鍵分點', 'BSR', '分點集中度', '27/5', '最後成功日']) {
      expect(html.includes(text), `畫面不得出現「${text}」`).toBe(false);
    }
    // 三大法人主體仍在（只移除分點 surface，不是整個籌碼面）
    expect(screen.getByTestId('chips-institutional')).toBeTruthy();
  });

  it('預設（其他 surface）仍保留分點能力', async () => {
    const { default: ChipsSection } = await import('@/checkup/components/freecheckup/ChipsSection');
    render(<ChipsSection WB={WB} stockCode="2330" />);
    expect(screen.getByTestId('chips-bsr-quality-badge')).toBeTruthy();
  });
});
