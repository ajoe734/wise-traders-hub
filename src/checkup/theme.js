export const C = {
  // ── 底色系：極深海軍藍黑，參考 Dribbble 頂級交易終端 ──
  bg:        "#05050D",
  shell:     "#08091A",
  card:      "#0D0F1C",
  cardHover: "#12152A",
  subtle:    "#0A0C18",
  subtleElev: "#0F1224",
  border:    "rgba(157,160,178,0.08)",
  borderSub: "rgba(157,160,178,0.04)",
  borderStrong: "rgba(157,160,178,0.14)",
  borderSoft: "rgba(157,160,178,0.06)",
  shadow:    "0 4px 24px rgba(0,0,0,0.45)",
  insetLine: "inset 0 1px 0 rgba(157,160,178,0.04)",
  shellShadow:"0 8px 40px rgba(0,0,0,0.55)",

  // ── 功能色卡片：帶微妙色調的深色 ──
  cardBlue:  "#0A0E22",
  cardAmber: "#120E08",
  cardOlive: "#0A1210",
  cardRose:  "#130A14",

  // ── 文字階層：高對比度淨白系 ──
  text:      "#ECEDF0",
  textSec:   "#9DA0B2",
  textMute:  "#545767",

  // ── 漲跌：精煉的紅綠，更現代 ──
  up:        "#E5484D",
  upBg:      "rgba(229,72,77,0.08)",
  down:      "#30A46C",
  downBg:    "rgba(48,164,108,0.08)",

  // ── 功能色：Dribbble 級精煉色票 ──
  blue:      "#5898F1",
  blueBg:    "rgba(88,152,241,0.08)",
  cyan:      "#4CC9F0",
  cyanBg:    "rgba(76,201,240,0.06)",
  amber:     "#E5A100",
  amberBg:   "rgba(229,161,0,0.08)",
  orange:    "#ED8936",
  orangeBg:  "rgba(237,137,54,0.07)",
  teal:      "#28ECAC",
  tealBg:    "rgba(40,236,172,0.07)",
  mint:      "#2DD4A8",
  mintBg:    "rgba(45,212,168,0.07)",
  olive:     "#7BC96F",
  oliveBg:   "rgba(123,201,111,0.07)",
  lavender:  "#9B8AFB",
  lavBg:     "rgba(155,138,251,0.07)",
  rose:      "#F0718B",
  roseBg:    "rgba(240,113,139,0.07)",
  choco:     "#D4890B",
  chocoBg:   "rgba(212,137,11,0.07)",
  stone:     "#6D728B",
  urgent:    "#E5484D",
  onFill:    "#FFFFFF",
  focusRing: "0 0 0 2px rgba(40,236,172,0.30)",

  // ── 實色填充 ──
  fillTeal:    "#1A9E7A",
  fillTomato:  "#C13030",
  fillChoco:   "#8B5A0A",
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
