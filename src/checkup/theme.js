export const C = {
  // ── 底色系：柔和深灰藍，低疲勞感 ──
  bg:        "#0B0E14",
  shell:     "#0E1118",
  card:      "#13161F",
  cardHover: "#181C27",
  subtle:    "#101319",
  subtleElev: "#151922",
  border:    "rgba(148,163,184,0.07)",
  borderSub: "rgba(148,163,184,0.04)",
  borderStrong: "rgba(148,163,184,0.12)",
  borderSoft: "rgba(148,163,184,0.05)",
  shadow:    "0 2px 12px rgba(0,0,0,0.25)",
  insetLine: "inset 0 1px 0 rgba(148,163,184,0.03)",
  shellShadow:"0 4px 20px rgba(0,0,0,0.30)",

  // ── 功能色卡片：極微色調偏移 ──
  cardBlue:  "#101420",
  cardAmber: "#15130F",
  cardOlive: "#101614",
  cardRose:  "#161017",

  // ── 文字階層：柔和白系，降低刺眼感 ──
  text:      "#D8DBE3",
  textSec:   "#8B90A0",
  textMute:  "#4D5264",

  // ── 漲跌：降飽和度，護眼 ──
  up:        "#CF6679",
  upBg:      "rgba(207,102,121,0.07)",
  down:      "#4DB88A",
  downBg:    "rgba(77,184,138,0.06)",

  // ── 功能色：低飽和度柔和色系 ──
  blue:      "#6B9FD4",
  blueBg:    "rgba(107,159,212,0.07)",
  cyan:      "#66B8D6",
  cyanBg:    "rgba(102,184,214,0.05)",
  amber:     "#D4A643",
  amberBg:   "rgba(212,166,67,0.07)",
  orange:    "#D49560",
  orangeBg:  "rgba(212,149,96,0.06)",
  teal:      "#4DBFA0",
  tealBg:    "rgba(77,191,160,0.06)",
  mint:      "#4EC9A4",
  mintBg:    "rgba(78,201,164,0.06)",
  olive:     "#7FB872",
  oliveBg:   "rgba(127,184,114,0.06)",
  lavender:  "#8D83D4",
  lavBg:     "rgba(141,131,212,0.06)",
  rose:      "#D47B8E",
  roseBg:    "rgba(212,123,142,0.06)",
  choco:     "#C49040",
  chocoBg:   "rgba(196,144,64,0.06)",
  stone:     "#646A7E",
  urgent:    "#CF6679",
  onFill:    "#F0F0F0",
  focusRing: "0 0 0 2px rgba(77,191,160,0.20)",

  // ── 實色填充 ──
  fillTeal:    "#2E8F72",
  fillTomato:  "#A84040",
  fillChoco:   "#7A5520",
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
