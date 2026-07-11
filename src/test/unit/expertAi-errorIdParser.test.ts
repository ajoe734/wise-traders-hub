import { describe, it, expect } from 'vitest';
import { extractErrorIdFromMessage, ERROR_ID_PATTERN } from '@/pages/_expertAiChat/errorIdParser';

describe('extractErrorIdFromMessage', () => {
  it('抽出後端全形括號格式的 errorId', () => {
    const msg = 'AI 對話串流失敗（errorId: err_lz1abcd_9x8y7z）：upstream rate limit';
    expect(extractErrorIdFromMessage(msg)).toBe('err_lz1abcd_9x8y7z');
  });

  it('支援中文冒號分隔', () => {
    expect(extractErrorIdFromMessage('壞掉了 errorId：err_abc_123456')).toBe('err_abc_123456');
  });

  it('無 errorId 時回傳 null', () => {
    expect(extractErrorIdFromMessage('random failure')).toBeNull();
    expect(extractErrorIdFromMessage('')).toBeNull();
    expect(extractErrorIdFromMessage(undefined)).toBeNull();
    expect(extractErrorIdFromMessage(null)).toBeNull();
  });

  it('regex 對 err_ 前綴敏感，避免亂抓 id', () => {
    expect(ERROR_ID_PATTERN.test('errorId: something_else')).toBe(false);
  });
});
