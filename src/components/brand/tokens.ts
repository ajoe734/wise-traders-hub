/**
 * legendflow brand tokens — single source of truth.
 * 對應 brand/brand-kit.html v1 (2026-05-18)。
 *
 * 不要在 component 寫死 hex；只能從這裡 import。
 */
export const BRAND = {
  cta: '#EC662D',
  ink: '#0B120E',
  inkSoft: '#2F3232',
  iron: '#838585',
  bone: '#E7E0D6',
  boneSoft: '#FAFAFA',
} as const;

export const BRAND_FONT_SERIF =
  "'Source Serif 4','Noto Serif TC',Georgia,serif";

export const BRAND_FONT_MONO =
  "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
