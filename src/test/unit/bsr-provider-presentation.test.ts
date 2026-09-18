import { describe, it, expect } from 'vitest';
import {
  bsrCardPausedLine,
  bsrDrawerEntitlementLine,
  decideCaptchaFallback,
  isCaptchaFallbackAllowed,
  isEntitlementBlocked,
  resolveBsrRetryNote,
} from '@/checkup/lib/bsrProviderPresentation';

describe('bsrProviderPresentation', () => {
  it('卡片列不含「需授權」字樣，只說暫停與最後成功日', () => {
    expect(bsrCardPausedLine('2026-08-14')).toBe('券商分點更新暫停 · 最後成功 2026/08/14');
    expect(bsrCardPausedLine(null)).toBe('券商分點更新暫停');
    expect(bsrCardPausedLine('2026-08-14')).not.toContain('需授權');
  });

  it('抽屜列只說更新暫停，不暴露 provider 或授權資訊', () => {
    expect(bsrDrawerEntitlementLine('2026-08-14')).toBe('券商分點更新暫停 · 最後成功 2026/08/14');
    expect(bsrDrawerEntitlementLine(null)).toBe('券商分點更新暫停');
    expect(bsrDrawerEntitlementLine('2026-08-14')).not.toMatch(/FinMind|Sponsor|授權/);
  });

  it('terminal 判定收斂 provider state 與 code', () => {
    expect(isEntitlementBlocked({ providerState: 'terminal_provider_rejected' })).toBe(true);
    expect(isEntitlementBlocked({ providerCode: 'provider_plan_rejected' })).toBe(true);
    expect(isEntitlementBlocked({ providerState: 'retryable' })).toBe(false);
    expect(isEntitlementBlocked(null)).toBe(false);
  });

  it('terminal 時不得回傳任何回推區間', () => {
    const note = resolveBsrRetryNote({
      terminal: true,
      lookbackFrom: '2026-08-17',
      lookbackTo: '2026-08-17',
      lookbackDays: 1,
      tradeDate: '2026-08-17',
    });
    expect(note.kind).toBe('none_since_entitlement');
    expect(note.text).toBe('更新暫停期間未再嘗試');
    expect(note.text).not.toContain('授權');
  });

  it('transient 有 from/to 顯示真實區間；只有單日則顯示單日；皆無則 —', () => {
    expect(
      resolveBsrRetryNote({ terminal: false, lookbackFrom: '2026-09-16', lookbackTo: '2026-09-11', lookbackDays: 4 }),
    ).toEqual({ kind: 'range', text: '2026/09/11 ~ 2026/09/16（共 4 個日期）' });
    expect(resolveBsrRetryNote({ terminal: false, lookbackFrom: '2026-09-16', lookbackTo: '2026-09-16', lookbackDays: 1 }).text).toBe(
      '2026/09/16 ~ 2026/09/16',
    );
    expect(resolveBsrRetryNote({ terminal: false, tradeDate: '2026-09-04' })).toEqual({
      kind: 'single',
      text: '2026/09/04',
    });
    expect(resolveBsrRetryNote({ terminal: false }).kind).toBe('unknown');
  });

  it('CAPTCHA fallback 在授權層拒絕時 fail-closed', () => {
    expect(isCaptchaFallbackAllowed({ providerState: 'terminal_provider_rejected' })).toBe(false);
    expect(decideCaptchaFallback({ providerCode: 'provider_plan_rejected' })).toEqual({
      allowed: false,
      reason: 'captcha_fallback_disabled',
    });
    expect(decideCaptchaFallback({ providerState: 'retryable' })).toEqual({ allowed: true, reason: null });
  });
});
