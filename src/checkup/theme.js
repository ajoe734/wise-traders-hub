export const C = {
  // ── 底色系：深沉中性，彰顯專業 ──
  bg:        "#0D1117",
  shell:     "#111820",
  card:      "#161B22",
  cardHover: "#1C2330",
  subtle:    "#141A22",
  subtleElev: "#1A2029",
  border:    "rgba(240,246,252,0.08)",
  borderSub: "rgba(240,246,252,0.05)",
  borderStrong: "rgba(240,246,252,0.12)",
  borderSoft: "rgba(240,246,252,0.06)",
  shadow:    "0 8px 24px rgba(0,0,0,0.25)",
  insetLine: "inset 0 1px 0 rgba(240,246,252,0.03)",
  shellShadow:"0 16px 48px rgba(0,0,0,0.35)",

  // ── 功能色卡片 ──
  cardBlue:  "#131D2E",
  cardAmber: "#1A1A14",
  cardOlive: "#121D19",
  cardRose:  "#1D1519",

  // ── 文字階層 ──
  text:      "#E6EDF3",
  textSec:   "#9EAAB6",
  textMute:  "#5C6A75",

  // ── 漲跌：經典紅綠，高辨識度 ──
  up:        "#EF4444",
  upBg:      "rgba(239,68,68,0.08)",
  down:      "#22C55E",
  downBg:    "rgba(34,197,94,0.08)",

  // ── 功能色：冷調高雅 ──
  blue:      "#58A6FF",
  blueBg:    "rgba(88,166,255,0.08)",
  cyan:      "#56D4DD",
  cyanBg:    "rgba(86,212,221,0.08)",
  amber:     "#D29922",
  amberBg:   "rgba(210,153,34,0.08)",
  orange:    "#DB8B3E",
  orangeBg:  "rgba(219,139,62,0.08)",
  teal:      "#39D2C0",
  tealBg:    "rgba(57,210,192,0.08)",
  mint:      "#56D4A5",
  mintBg:    "rgba(86,212,165,0.08)",
  olive:     "#7EBF6A",
  oliveBg:   "rgba(126,191,106,0.08)",
  lavender:  "#BC9BF2",
  lavBg:     "rgba(188,155,242,0.08)",
  rose:      "#F778A8",
  roseBg:    "rgba(247,120,168,0.08)",
  choco:     "#C69463",
  chocoBg:   "rgba(198,148,99,0.08)",
  stone:     "#8B949E",
  urgent:    "#EF4444",
  onFill:    "#FFFFFF",
  focusRing: "0 0 0 2px rgba(88,166,255,0.3)",

  // ── 實色填充 ──
  fillTeal:    "#1A7F72",
  fillTomato:  "#C13B3B",
  fillChoco:   "#8B5E3C",
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
