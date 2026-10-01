import { describe, expect, it } from 'vitest';
import { basisVerificationText } from './HoldingsDetailPanel';

describe('財報分母與股數核對來源文案', () => {
  it('只有官方名錄成功時才稱股數已由官方核對', () => {
    expect(basisVerificationText({ basisCount: 3, shareVerification: { source: 'official', preferredUnknown: false } })).toBe(
      '財報分母 3/3 已計算；股數已由官方名錄核對',
    );
  });

  it('後備來源且特別股未知時不使用已核實措辭', () => {
    const text = basisVerificationText({ basisCount: 3, shareVerification: { source: 'fallback', preferredUnknown: true } });
    expect(text).toBe('財報分母 3/3 已計算；股數採後備核對，特別股待官方確認');
    expect(text).not.toContain('已核實');
  });
});