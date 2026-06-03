/**
 * Checkup 配額顯示回歸 — 不同 tier 必須顯示對應文案 + last_used_at YYYY/MM/DD。
 * 涵蓋：HoldingsQuotaMeter（持倉看板）
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldingsQuotaMeter from '@/checkup/components/freecheckup/HoldingsQuotaMeter';

const C = {
  bg: '#fff', card: '#fafafa', border: '#e5e5e5',
  text: '#111', textSec: '#444', textMute: '#888',
  up: '#d32f2f', down: '#1b873f', teal: '#0ea5a4', amber: '#d97706', blue: '#2563eb',
};
const alpha = (c: string, a: string) => `${c}${a}`;
const formatResetCountdown = (_iso?: string) => '剩餘 2 天';

const LAST_USED_ISO = '2026-05-27T12:00:00Z'; // TW 2026/05/27 20:00
const EXPECTED_YMD = '2026/05/27';

function renderMeter(quota: any, tier: string, tierLabel: string, isDemo = false) {
  return render(
    <HoldingsQuotaMeter
      isDemo={isDemo} quota={quota} tier={tier} tierLabel={tierLabel}
      C={C as any} alpha={alpha} formatResetCountdown={formatResetCountdown}
    />,
  );
}

const text = (container: HTMLElement) => (container.textContent || '').replace(/\s+/g, ' ');

describe('HoldingsQuotaMeter — tier × last_used_at 文案矩陣', () => {
  it('isDemo=true → 不渲染（訪客）', () => {
    const { container } = renderMeter(null, 'guest', '訪客', true);
    expect(container.firstChild).toBeNull();
  });

  it('quota=null → 顯示「載入配額中…」', () => {
    const { container } = renderMeter(null, 'free', '免費版');
    expect(text(container)).toContain('載入配額中');
  });

  it('tier=line_free + remain>0 → 「LINE 註冊禮：第一次免費；第二次起需付費・還剩 1 次」', () => {
    const { container } = renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 0, remaining: 1, resets_at: 'infinity', last_used_at: null },
      'line_free', 'LINE 註冊禮',
    );
    const t = text(container);
    expect(t).toMatch(/LINE 註冊禮：第一次免費；第二次起需付費/);
    expect(t).toMatch(/還剩 1 次/);
    expect(t).not.toMatch(/已用完/);
    expect(t).not.toMatch(/使用日/);
  });

  it('tier=line_free + remain=0 + 有 last_used_at → 「已用完・使用日 YYYY/MM/DD・升級後可繼續使用」+ 升級 CTA', () => {
    const { container } = renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: LAST_USED_ISO },
      'line_free', 'LINE 註冊禮',
    );
    const t = text(container);
    expect(t).toMatch(/LINE 註冊禮已用完/);
    expect(t).toContain(`使用日 ${EXPECTED_YMD}`);
    expect(t).toMatch(/升級後可繼續使用/);
    expect(t).toMatch(/查看訂閱方案/);
  });

  it('tier=line_free + remain=0 + 無 last_used_at → 顯示「使用日 尚未紀錄」fallback', () => {
    const { container } = renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: null },
      'line_free', 'LINE 註冊禮',
    );
    const t = text(container);
    expect(t).toMatch(/LINE 註冊禮已用完/);
    expect(t).toContain('使用日 尚未紀錄');
    expect(t).toMatch(/升級後可繼續使用/);
  });

  it('tier=none → 「收盤分析（訂閱解鎖）」+ 隱藏使用數字 + 升級 CTA', () => {
    const { container } = renderMeter(
      { tier: 'none', period: 'month', limit: 0, used: 0, remaining: 0, resets_at: null, last_used_at: null },
      'none', '未訂閱',
    );
    const t = text(container);
    expect(t).toContain('收盤分析（訂閱解鎖）');
    expect(t).toContain('尚未訂閱，無法使用 AI 收盤分析');
    expect(t).toContain('查看訂閱方案');
    expect(t).not.toMatch(/還剩/);
  });

  it('tier=pro + used=5/22 → 「使用 5 / 22 次・還剩 17 次・剩餘 2 天」', () => {
    const { container } = renderMeter(
      { tier: 'pro', period: 'month', limit: 22, used: 5, remaining: 17, resets_at: '2026-07-01T00:00:00Z', last_used_at: LAST_USED_ISO },
      'pro', 'Pro',
    );
    const t = text(container);
    expect(t).toMatch(/使用 5 \/ 22 次/);
    expect(t).toMatch(/還剩 17 次/);
    expect(t).toContain('剩餘 2 天');
    expect(t).not.toMatch(/LINE 註冊禮/);
  });

  it('tier=basic + remain=1 → 顯示「最後一次・用完前先升級」', () => {
    const { container } = renderMeter(
      { tier: 'basic', period: 'week', limit: 1, used: 0, remaining: 1, resets_at: '2026-06-09T00:00:00Z', last_used_at: null },
      'basic', 'Basic',
    );
    const t = text(container);
    expect(t).toContain('最後一次');
    expect(t).toContain('用完前先升級');
    expect(t).toMatch(/升級/);
  });
});

describe('HoldingsQuotaMeter — last_used_at 日期格式化（Asia/Taipei）', () => {
  it.each([
    ['2026-05-27T12:00:00Z', '2026/05/27'],
    ['2026-05-27T16:30:00Z', '2026/05/28'], // +8h 跨日
    ['2026-01-01T00:00:00Z', '2026/01/01'],
    ['2025-12-31T23:00:00Z', '2026/01/01'], // 跨年
  ])('iso=%s → 使用日 %s', (iso, expected) => {
    const { container } = renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: iso },
      'line_free', 'LINE 註冊禮',
    );
    expect(text(container)).toContain(`使用日 ${expected}`);
  });

  it('iso=invalid → fallback「使用日 尚未紀錄」（safe fallback，不渲染壞日期）', () => {
    const { container } = renderMeter(
      { tier: 'line_free', period: 'lifetime', limit: 1, used: 1, remaining: 0, resets_at: 'infinity', last_used_at: 'not-a-date' },
      'line_free', 'LINE 註冊禮',
    );
    const t = text(container);
    expect(t).not.toMatch(/使用日 \d{4}\/\d{2}\/\d{2}/);
    expect(t).toContain('使用日 尚未紀錄');
  });
});
