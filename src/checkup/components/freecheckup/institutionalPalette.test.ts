import { describe, expect, it } from 'vitest';
import { INSTITUTIONAL_PALETTE, institutionalTone } from './institutionalPalette';

describe('三大法人固定身份色', () => {
  it('外資、投信、自營商各自固定為深墨、中灰、淺灰，不依正負改色', () => {
    expect(institutionalTone('foreign_net', 100)).toBe(INSTITUTIONAL_PALETTE.foreign_net);
    expect(institutionalTone('foreign_net', -100)).toBe(INSTITUTIONAL_PALETTE.foreign_net);
    expect(institutionalTone('trust_net', 100)).toBe(INSTITUTIONAL_PALETTE.trust_net);
    expect(institutionalTone('trust_net', -100)).toBe(INSTITUTIONAL_PALETTE.trust_net);
    expect(institutionalTone('dealer_net', 100)).toBe(INSTITUTIONAL_PALETTE.dealer_net);
    expect(institutionalTone('dealer_net', -100)).toBe(INSTITUTIONAL_PALETTE.dealer_net);
    expect(new Set(Object.values(INSTITUTIONAL_PALETTE)).size).toBe(3);
  });
});