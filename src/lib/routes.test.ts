import { describe, it, expect } from 'vitest';
import { renewalUrl } from './routes';

describe('renewalUrl', () => {
  it('回傳公開結帳路徑（不經過 /app 守衛）', () => {
    expect(renewalUrl('foo', 'bar')).toBe('/checkout/foo/bar');
  });

  it('預設不加任何站台前綴', () => {
    expect(renewalUrl('foo', 'bar').startsWith('/')).toBe(true);
    expect(renewalUrl('foo', 'bar')).not.toContain('http');
  });

  it('絕不產出 /app/checkout 路徑', () => {
    expect(renewalUrl('foo', 'bar')).not.toContain('/app/');
  });

  it('給 baseUrl 時輸出絕對網址且不重複斜線', () => {
    expect(renewalUrl('foo', 'bar', { baseUrl: 'https://legendflow.tw/' })).toBe(
      'https://legendflow.tw/checkout/foo/bar',
    );
  });

  it('對 slug 與 planId 做 URL 編碼', () => {
    expect(renewalUrl('a b', 'p/1')).toBe('/checkout/a%20b/p%2F1');
  });

  it('缺少 slug 或 planId 時丟出錯誤', () => {
    expect(() => renewalUrl('', 'bar')).toThrow();
    expect(() => renewalUrl('foo', '')).toThrow();
  });
});
