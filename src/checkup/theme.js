export const C = {
  bg:        "#283D3B",
  shell:     "#2D4341",
  card:      "#314846",
  cardHover: "#385250",
  subtle:    "#2C4240",
  subtleElev: "#34504D",
  border:    "rgba(237,221,212,0.09)",
  borderSub: "rgba(237,221,212,0.06)",
  borderStrong: "rgba(237,221,212,0.13)",
  borderSoft: "rgba(237,221,212,0.08)",
  shadow:    "0 10px 30px rgba(9,16,16,0.12)",
  insetLine: "inset 0 1px 0 rgba(237,221,212,0.04)",
  shellShadow:"0 18px 40px rgba(8,14,14,0.18)",

  cardBlue:  "#32474A",
  cardAmber: "#3F4640",
  cardOlive: "#334841",
  cardRose:  "#434642",

  text:      "#EDDDD4",
  textSec:   "#C7BBB3",
  textMute:  "#A0948D",

  up:        "#C97A70",
  upBg:      "#C445361a",
  down:      "#5B8F93",
  downBg:    "#19727822",

  blue:      "#78AAB0",
  blueBg:    "#78AAB014",
  cyan:      "#73A9AE",
  cyanBg:    "#73A9AE14",
  amber:     "#B79173",
  amberBg:   "#B7917314",
  orange:    "#AC8468",
  orangeBg:  "#AC846814",
  teal:      "#6E9B9D",
  tealBg:    "#6E9B9D14",
  mint:      "#779E93",
  mintBg:    "#779E9314",
  olive:     "#7D957D",
  oliveBg:   "#4A8C6F22",
  lavender:  "#A79389",
  lavBg:     "#A7938914",
  rose:      "#AA8A91",
  roseBg:    "#AA8A9114",
  choco:     "#A47A5F",
  chocoBg:   "#A47A5F14",
  stone:     "#9F938C",
  urgent:    "#C97A70",
  onFill:    "#EDDDD4",
  focusRing: "0 0 0 3px rgba(237,221,212,0.08)",

  fillTeal:    "#197278",
  fillTomato:  "#A9645C",
  fillChoco:   "#772E25",
};

export const A = {
  tint: "10",
  faint: "16",
  soft: "20",
  line: "30",
  strongLine: "40",
  accent: "4d",
  glow: "58",
  solid: "78",
  overlay: "a8",
  pressed: "bc",
};

export const alpha = (color, opacity) => `${color}${opacity}`;

export function applyThemeVars(target = document.documentElement) {
  if (!target?.style) return;
  target.style.setProperty("--app-bg", C.bg);
}
