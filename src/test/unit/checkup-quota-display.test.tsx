/**
 * Checkup 配額顯示回歸 — 不同 tier 必須顯示對應文案 + last_used_at YYYY/MM/DD。
 * 涵蓋：HoldingsQuotaMeter（持倉看板）
 * 對應記憶：LINE 註冊禮第一次免費；第二次起需付費 + 顯示使用日。
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HoldingsQuotaMeter from '@/checkup/components/freecheckup/HoldingsQuotaMeter';

const C = {
  bg: '#fff', card: '#fafafa', border: '#e5e5e5',
  text: '#111', textSec: '#444', textMute: '#888',
  up: '#d32f2f', down: '#1b873f', teal: '#0ea5a4', amber: '#d97706', blue: '#2563eb',
};
const alpha = (c: string, a: string) => `${c}${a}`;
const formatResetCountdown = (_iso?: string) => '剩餘 2 天';

// 2026/05/27 12:00 UTC → TW 2026/05/27 20:00
const LAST_USED_ISO = '2026-05-27T12:00:00Z';
const EXPECTED_YMD = '2026/05/27';

function renderMeter(quota: any, tier: string, tierLabel: string, isDemo = false) {
  return render(
    <HoldingsQuotaMeter
      isDemo={isDemo}
      quota={quota}
      tier={tier}
      tierLabel={tierLabel}
      C={C as any}
      alpha={alpha}
      formatResetCountdown={formatResetCountdown}
    />,
  );
}

describe('HoldingsQuotaMeter — tier × last_used_at 文案矩陣', () => {
  it('isDemo=true → 不渲染（訪客）', () => {
    const { container } = renderMeter(null, 'guest', '訪客', true);
    expect(container.firstChild).toBeNull();
  });

  it('quota=null → 顯示「載入配額中…」', () => {
    renderMeter(null, 'free', '免費版');
    expect(screen.getByText('載入配額中…')).toBeInTheDocument();
  });

  it('tier=line_free + remain>0 → 顯示「LINE 註冊禮：第一次免費；第二次起需付費」+ 還剩 1 次', () => {
    renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 0, remaining: 1, resets_at: 'infinity', last_used_at: null },
      'line_free', 'LINE 註冊禮',
    );
    expect(screen.getByText(/LINE 註冊禮：第一次免費；第二次起需付費/)).toBeInTheDocument();
    expect(screen.getByText('1', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText(/已用完/)).not.toBeInTheDocument();
  });

  it('tier=line_free + remain=0 + 有 last_used_at → 顯示「已用完・使用日 YYYY/MM/DD」+ 升級 CTA', () => {
    renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: LAST_USED_ISO },
      'line_free', 'LINE 註冊禮',
    );
    expect(screen.getByText(/LINE 註冊禮已用完/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`使用日 ${EXPECTED_YMD}`))).toBeInTheDocument();
    expect(screen.getByText(/升級後可繼續使用/)).toBeInTheDocument();
    // CTA
    expect(screen.getByText('查看訂閱方案')).toBeInTheDocument();
  });

  it('tier=line_free + remain=0 + 無 last_used_at → 不顯示「使用日」段', () => {
    renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: null },
      'line_free', 'LINE 註冊禮',
    );
    expect(screen.getByText(/LINE 註冊禮已用完/)).toBeInTheDocument();
    expect(screen.queryByText(/使用日/)).not.toBeInTheDocument();
  });

  it('tier=none → 顯示「收盤分析（訂閱解鎖）」+ 隱藏進度條與使用數字', () => {
    renderMeter(
      { tier: 'none', period: 'month', limit: 0, used: 0, remaining: 0, resets_at: null, last_used_at: null },
      'none', '未訂閱',
    );
    expect(screen.getByText('收盤分析（訂閱解鎖）')).toBeInTheDocument();
    expect(screen.getByText('尚未訂閱，無法使用 AI 收盤分析')).toBeInTheDocument();
    expect(screen.getByText('查看訂閱方案')).toBeInTheDocument();
  });

  it('tier=pro + 有 used → 顯示「使用 X / Y 次・還剩 Z 次」+ 重置倒數', () => {
    renderMeter(
      { tier: 'pro', period: 'month', limit: 22, used: 5, remaining: 17, resets_at: '2026-07-01T00:00:00Z', last_used_at: LAST_USED_ISO },
      'pro', 'Pro',
    );
    expect(screen.getByText(/使用/)).toBeInTheDocument();
    expect(screen.getByText(/還剩/)).toBeInTheDocument();
    expect(screen.getByText('剩餘 2 天')).toBeInTheDocument();
    // 不應出現 line_free 文案
    expect(screen.queryByText(/LINE 註冊禮/)).not.toBeInTheDocument();
  });

  it('tier=basic + remain=1 → 顯示「最後一次」警告與升級 CTA', () => {
    renderMeter(
      { tier: 'basic', period: 'week', limit: 1, used: 0, remaining: 1, resets_at: '2026-06-09T00:00:00Z', last_used_at: null },
      'basic', 'Basic',
    );
    expect(screen.getByText('最後一次')).toBeInTheDocument();
    expect(screen.getByText('升級 Pro')).toBeInTheDocument();
  });
});

describe('HoldingsQuotaMeter — 日期格式化（Asia/Taipei）', () => {
  it.each([
    ['2026-05-27T12:00:00Z', '2026/05/27'],
    ['2026-05-27T16:30:00Z', '2026/05/28'], // +8h 跨日
    ['2026-01-01T00:00:00Z', '2026/01/01'],
    ['2025-12-31T23:00:00Z', '2026/01/01'], // 跨年
  ])('iso=%s → %s', (iso, expected) => {
    renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: iso },
      'line_free', 'LINE 註冊禮',
    );
    expect(screen.getByText(new RegExp(`使用日 ${expected}`))).toBeInTheDocument();
  });
});
