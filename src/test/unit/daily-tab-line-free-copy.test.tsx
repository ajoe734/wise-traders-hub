/**
 * DailyTab — LINE 註冊禮配額文案矩陣（line_free × used × last_used_at）
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import DailyTab from '@/checkup/components/freecheckup/DailyTab.jsx';

function renderDaily(quota: any, tier: string, hasReached: boolean) {
  const C: any = {
    text: '#111', textSec: '#444', textMute: '#888', bg: '#fff', border: '#ddd',
    blue: '#2563eb', teal: '#0d9488', amber: '#d97706', up: '#dc2626', down: '#16a34a',
  };
  const props: any = {
    isDemo: false,
    navigate: vi.fn(),
    startLineLogin: vi.fn(),
    C,
    alpha: (c: string) => c,
    DEMO_TAB_NOTICE_COPY: { daily: { title: '', body: '' } },
    demoDailyMode: 'static',
    setDemoDailyMode: vi.fn(),
    dailyReport: null,
    setDailyReport: vi.fn(),
    analyzing: false,
    analyzeStep: '',
    runDailyAnalysis: vi.fn(),
    hasReachedDailyLimit: hasReached,
    quota,
    formatResetCountdown: () => '剩餘 2 天',
    tier,
    dailyLastError: null,
    setDailyLastError: vi.fn(),
    dailyErrorRef: { current: null },
    dailyRetryHistory: [],
    dailyRetryLocked: false,
    handleDailyRetry: vi.fn(),
    pc: (n: number) => (n >= 0 ? '#dc2626' : '#16a34a'),
    setTab: vi.fn(),
    setExpandedNews: vi.fn(),
    coverageOpen: false,
    setCoverageOpen: vi.fn(),
    coverageReport: null,
    setCoverageReport: vi.fn(),
    strategyBrain: null,
    setStrategyBrain: vi.fn(),
    save: vi.fn(),
    cloudSync: false,
    analysisHistory: [],
  };
  return render(React.createElement(DailyTab as any, props));
}

const text = (c: HTMLElement) => (c.textContent || '').replace(/\s+/g, ' ');

describe('DailyTab — LINE 註冊禮文案', () => {
  it('line_free + remain=1 → 「還可使用 1 次」', () => {
    const { container } = renderDaily(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 0, remaining: 1, resets_at: 'infinity', last_used_at: null },
      'line_free', false,
    );
    const t = text(container);
    expect(t).toContain('LINE 註冊禮：第一次免費；第二次起需付費');
    expect(t).toMatch(/還可使用 1 次/);
  });

  it('line_free + remain=0 + 有 last_used_at → Asia/Taipei 使用日', () => {
    const { container } = renderDaily(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: '2026-06-03T05:30:00Z' },
      'line_free', true,
    );
    const t = text(container);
    expect(t).toContain('已用完');
    expect(t).toContain('使用日 2026/06/03');
    expect(t).toContain('查看訂閱方案');
  });

  it('line_free + remain=0 + null last_used_at → fallback「使用日 尚未紀錄」', () => {
    const { container } = renderDaily(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: null },
      'line_free', true,
    );
    const t = text(container);
    expect(t).toContain('使用日 尚未紀錄');
    expect(t).not.toMatch(/使用日 \d{4}\/\d{2}\/\d{2}/);
  });

  it('跨日：UTC 16:30 → 隔日台北', () => {
    const { container } = renderDaily(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: '2026-06-03T16:30:00Z' },
      'line_free', true,
    );
    expect(text(container)).toContain('使用日 2026/06/04');
  });
});
