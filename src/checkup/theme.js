export const C = {
  // ── 底色系：深邃冷灰，專業金融終端感 ──
  bg:        "#0B0E11",
  shell:     "#0F1216",
  card:      "#141820",
  cardHover: "#191E28",
  subtle:    "#121620",
  subtleElev: "#171C26",
  border:    "rgba(148,163,184,0.08)",
  borderSub: "rgba(148,163,184,0.05)",
  borderStrong: "rgba(148,163,184,0.14)",
  borderSoft: "rgba(148,163,184,0.06)",
  shadow:    "0 4px 16px rgba(0,0,0,0.3)",
  insetLine: "inset 0 1px 0 rgba(148,163,184,0.03)",
  shellShadow:"0 8px 32px rgba(0,0,0,0.4)",

  // ── 功能色卡片 ──
  cardBlue:  "#111827",
  cardAmber: "#161412",
  cardOlive: "#111916",
  cardRose:  "#18131A",

  // ── 文字階層 ──
  text:      "#E2E8F0",
  textSec:   "#94A3B8",
  textMute:  "#4B5563",

  // ── 漲跌：經典紅綠（適度降飽和）──
  up:        "#DC2626",
  upBg:      "rgba(220,38,38,0.07)",
  down:      "#16A34A",
  downBg:    "rgba(22,163,74,0.07)",

  // ── 功能色：低飽和高辨識 ──
  blue:      "#60A5FA",
  blueBg:    "rgba(96,165,250,0.08)",
  cyan:      "#67E8F9",
  cyanBg:    "rgba(103,232,249,0.06)",
  amber:     "#F59E0B",
  amberBg:   "rgba(245,158,11,0.08)",
  orange:    "#FB923C",
  orangeBg:  "rgba(251,146,60,0.07)",
  teal:      "#2DD4BF",
  tealBg:    "rgba(45,212,191,0.07)",
  mint:      "#34D399",
  mintBg:    "rgba(52,211,153,0.07)",
  olive:     "#84CC16",
  oliveBg:   "rgba(132,204,22,0.07)",
  lavender:  "#A78BFA",
  lavBg:     "rgba(167,139,250,0.07)",
  rose:      "#FB7185",
  roseBg:    "rgba(251,113,133,0.07)",
  choco:     "#D97706",
  chocoBg:   "rgba(217,119,6,0.07)",
  stone:     "#6B7280",
  urgent:    "#DC2626",
  onFill:    "#FFFFFF",
  focusRing: "0 0 0 2px rgba(96,165,250,0.25)",

  // ── 實色填充 ──
  fillTeal:    "#0D9488",
  fillTomato:  "#B91C1C",
  fillChoco:   "#92400E",
};

export const A = {
  tint: "08",
  faint: "0f",
  soft: "18",
  line: "22",
  strongLine: "33",
  accent: "44",
  glow: "55",
  solid: "77",
  overlay: "aa",
  pressed: "cc",
};

export const alpha = (color, opacity) => `${color}${opacity}`;

export function applyThemeVars(target = document.documentElement) {
  if (!target?.style) return;
  target.style.setProperty("--app-bg", C.bg);
}
