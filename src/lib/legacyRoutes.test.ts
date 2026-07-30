import { describe, it, expect } from 'vitest';
import { resolveLegacyPath, normalizeNotificationPath } from './legacyRoutes';

describe('resolveLegacyPath (/me/* → 正式路徑)', () => {
  it('/me 導到 /app/account', () => {
    expect(resolveLegacyPath('/me')).toBe('/app/account');
  });

  it('保留 query 與 hash（A5 回歸）', () => {
    expect(resolveLegacyPath('/me', '?tab=billing', '#plans')).toBe(
      '/app/account?tab=billing#plans',
    );
  });

  it('已知子路徑對映到對應頁面而非全部丟到 account', () => {
    expect(resolveLegacyPath('/me/signals')).toBe('/app/signals');
    expect(resolveLegacyPath('/me/journals')).toBe('/app/journals');
    expect(resolveLegacyPath('/me/subscriptions')).toBe('/app/subscriptions');
    expect(resolveLegacyPath('/me/explore')).toBe('/app/explore');
    expect(resolveLegacyPath('/me/notifications')).toBe('/account/notifications');
    expect(resolveLegacyPath('/me/profile')).toBe('/account/profile');
  });

  it('帶動態參數的子路徑保留尾段', () => {
    expect(resolveLegacyPath('/me/signal/abc-123')).toBe('/app/signal/abc-123');
    expect(resolveLegacyPath('/me/journal/xyz')).toBe('/app/journal/xyz');
    expect(resolveLegacyPath('/me/expert/laozhou')).toBe('/app/expert/laozhou');
  });

  it('未知子路徑退回 /app/account 但仍保留 query/hash', () => {
    expect(resolveLegacyPath('/me/unknown/thing', '?a=1')).toBe('/app/account?a=1');
  });

  it('尾斜線與大小寫不影響對映', () => {
    expect(resolveLegacyPath('/ME/Signals/')).toBe('/app/signals');
  });

  it('非 legacy 路徑原樣回傳', () => {
    expect(resolveLegacyPath('/app/signals', '?x=1')).toBe('/app/signals?x=1');
  });

  it('legacy 帳號路徑收斂', () => {
    expect(resolveLegacyPath('/account/subscriptions')).toBe('/app/account');
    expect(resolveLegacyPath('/free-checkup', '?s=1')).toBe('/holding-checkup?s=1');
  });
});

describe('normalizeNotificationPath (A6)', () => {
  it('同站絕對網址轉為相對路徑', () => {
    expect(normalizeNotificationPath('https://legendflow.tw/app/signals?id=1')).toBe(
      '/app/signals?id=1',
    );
    expect(normalizeNotificationPath('https://www.legendflow.tw/me/journals')).toBe(
      '/app/journals',
    );
  });

  it('Storage signed URL 維持外部連結不改寫', () => {
    const signed =
      'https://x.supabase.co/storage/v1/object/sign/journal-exports/a.pdf?token=abc';
    expect(normalizeNotificationPath(signed)).toBe(signed);
  });

  it('其他第三方網址不改寫', () => {
    expect(normalizeNotificationPath('https://example.com/x')).toBe('https://example.com/x');
  });

  it('相對路徑補上前導斜線並套用 legacy 對映', () => {
    expect(normalizeNotificationPath('me/signals')).toBe('/app/signals');
  });

  it('空值回傳 null', () => {
    expect(normalizeNotificationPath(null)).toBeNull();
    expect(normalizeNotificationPath('')).toBeNull();
  });
});
