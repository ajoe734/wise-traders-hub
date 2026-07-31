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

  // ── 損益方向：單色橘紅憲法（正=橘、負=灰），不採紅綠對撞 ──
  up:        "#FF4D1F",
  upBg:      "rgba(236,102,45,0.07)",
  down:      "#8B8680",
  downBg:    "rgba(139,134,128,0.06)",
  // ── K 線：依台股慣例紅漲綠跌（獨立於損益色） ──
  klineUp:   "#E53E3E",
  klineDown: "#38A169",


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
  urgent:    "#FF4D1F",
  onFill:    "#F0F0F0",
  focusRing: "0 0 0 2px rgba(77,191,160,0.20)",

  // ── 實色填充 ──
  fillTeal:    "#2E8F72",
  fillTomato:  "#FF4D1F",
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

export const L = {
  bg:        "#F5F3EF",
  shell:     "#F2F0EB",
  card:      "#FFFFFF",
  cardHover: "#F8F6F2",
  subtle:    "#EEEAE4",
  subtleElev:"#E8E4DE",
  border:    "rgba(60,56,48,0.08)",
  borderSub: "rgba(60,56,48,0.04)",
  borderStrong:"rgba(60,56,48,0.14)",
  borderSoft:"rgba(60,56,48,0.06)",
  shadow:    "none",
  insetLine: "none",
  shellShadow:"none",
  cardBlue:  "#F2F4F7",
  cardAmber: "#F6F4F0",
  cardOlive: "#F2F5F3",
  cardRose:  "#F6F2F3",
  text:      "#292520",
  textSec:   "#403A34",
  textMute:  "#4F4942",
  up:        "#FF4D1F",
  upBg:      "rgba(236,102,45,0.06)",
  down:      "#403A34",
  downBg:    "rgba(138,133,127,0.05)",
  // ── K 線：依台股慣例紅漲綠跌（獨立於損益色） ──
  klineUp:   "#D93025",
  klineDown: "#1E8E3E",

  blue:      "#5A7A98",
  blueBg:    "rgba(90,122,152,0.06)",
  cyan:      "#4A7888",
  cyanBg:    "rgba(74,120,136,0.05)",
  amber:     "#8A7030",
  amberBg:   "rgba(138,112,48,0.06)",
  orange:    "#8A6040",
  orangeBg:  "rgba(138,96,64,0.05)",
  teal:      "#3A7060",
  tealBg:    "rgba(58,112,96,0.05)",
  mint:      "#3A7860",
  mintBg:    "rgba(58,120,96,0.05)",
  olive:     "#5A7050",
  oliveBg:   "rgba(90,112,80,0.05)",
  lavender:  "#6A5A90",
  lavBg:     "rgba(106,90,144,0.05)",
  rose:      "#906068",
  roseBg:    "rgba(144,96,104,0.05)",
  choco:     "#7A5828",
  chocoBg:   "rgba(122,88,40,0.05)",
  stone:     "#787068",
  urgent:    "#FF4D1F",
  onFill:    "#FFFFFF",
  focusRing: "none",
  fillTeal:   "#3A7060",
  fillTomato: "#FF4D1F",
  fillChoco:  "#7A5828",
};

export function applyThemeVars(target = document.documentElement) {
  if (!target?.style) return;
  target.style.setProperty("--app-bg", C.bg);
}
