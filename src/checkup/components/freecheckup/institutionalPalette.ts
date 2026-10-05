export const INSTITUTIONAL_PALETTE = {
  foreign_net: 'hsl(var(--holdings-flow-foreign))',
  trust_net: 'hsl(var(--holdings-flow-trust))',
  dealer_net: 'hsl(var(--holdings-flow-dealer))',
} as const;

export type InstitutionalKey = keyof typeof INSTITUTIONAL_PALETTE;

/** 法人顏色只表示身份；買賣方向由零線位置與正負號表達。 */
export function institutionalTone(key: InstitutionalKey, _value?: number | null): string {
  return INSTITUTIONAL_PALETTE[key];
}