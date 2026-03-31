import { createElement as h } from "react";
import { C } from "../../theme.js";
import { alpha } from "../../theme.js";

export function Card({ children, style = {}, highlighted = false, color = null, ...props }) {
  const baseStyle = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "12px 14px",
    boxShadow: `${C.insetLine}, ${C.shadow}`,
    ...(highlighted ? { borderLeft: `3px solid ${color || C.teal}` } : {}),
    ...style,
  };

  return h("div", { style: baseStyle, ...props }, children);
}

export function MetricCard({ label, value, tone = "default", style = {} }) {
  const toneColors = {
    default: C.text,
    up: C.up,
    down: C.down,
    muted: C.textMute,
    teal: C.teal,
    amber: C.amber,
  };

  return h("div", {
    style: {
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: "8px 11px",
      boxShadow: `${C.insetLine}, ${C.shadow}`,
      ...style,
    },
  },
    label && h("div", { style: { fontSize: 9, color: C.textMute, letterSpacing: "0.05em", fontWeight: 600, marginBottom: 3 } }, label),
    h("div", { style: { fontSize: 12, fontWeight: 600, color: toneColors[tone] || toneColors.default } }, value)
  );
}

export function Badge({ children, color = "default", size = "sm", style = {} }) {
  const colors = {
    default: { bg: C.subtle, text: C.textSec, border: C.border },
    up: { bg: C.upBg, text: C.up, border: alpha(C.up, "20") },
    down: { bg: C.downBg, text: C.down, border: alpha(C.down, "20") },
    teal: { bg: alpha(C.teal, "15"), text: C.teal, border: alpha(C.teal, "25") },
    amber: { bg: C.amberBg, text: C.amber, border: alpha(C.amber, "25") },
    olive: { bg: C.oliveBg, text: C.olive, border: alpha(C.olive, "25") },
    lavender: { bg: C.lavBg, text: C.lavender, border: alpha(C.lavender, "25") },
  };

  const sizes = {
    xs: { padding: "2px 6px", fontSize: 8 },
    sm: { padding: "3px 8px", fontSize: 9 },
    md: { padding: "4px 10px", fontSize: 10 },
  };

  const selectedColor = colors[color] || colors.default;
  const selectedSize = sizes[size] || sizes.sm;

  return h("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: selectedColor.bg,
      color: selectedColor.text,
      border: `1px solid ${selectedColor.border}`,
      borderRadius: 999,
      fontWeight: 600,
      letterSpacing: "0.02em",
      ...selectedSize,
      ...style,
    },
  }, children);
}

export function Button({ children, variant = "ghost", color = "default", size = "sm", disabled = false, onClick, style = {}, ...props }) {
  const A = { faint: "08", line: "1a", strongLine: "2a", glow: "40" };
  
  const variants = {
    ghost: {
      default: { bg: "transparent", text: C.textSec, border: "transparent" },
      blue: { bg: C.cardBlue, text: C.blue, border: alpha(C.blue, A.strongLine) },
      rose: { bg: C.cardRose, text: C.text, border: C.border },
      amber: { bg: C.cardAmber, text: C.amber, border: alpha(C.amber, A.strongLine) },
      olive: { bg: C.oliveBg, text: C.olive, border: alpha(C.olive, A.strongLine) },
      up: { bg: C.upBg, text: C.up, border: alpha(C.up, A.strongLine) },
    },
    filled: {
      default: { bg: C.subtle, text: C.text, border: C.border },
      blue: { bg: C.blue, text: "#fff", border: alpha(C.blue, A.strongLine) },
    },
  };

  const sizes = {
    xs: { padding: "3px 8px", fontSize: 8 },
    sm: { padding: "4px 11px", fontSize: 9 },
    md: { padding: "6px 14px", fontSize: 10 },
    lg: { padding: "8px 18px", fontSize: 11 },
  };

  const selectedVariant = variants[variant]?.[color] || variants.ghost.default;
  const selectedSize = sizes[size] || sizes.sm;

  return h("button", {
    className: "ui-btn",
    disabled,
    onClick,
    style: {
      borderRadius: 20,
      fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer",
      whiteSpace: "nowrap",
      transition: "all 0.18s ease",
      background: selectedVariant.bg,
      color: selectedVariant.text,
      border: `1px solid ${selectedVariant.border}`,
      ...selectedSize,
      ...style,
    },
    ...props,
  }, children);
}

export function SectionHeader({ title, description, action, style = {} }) {
  const lblStyle = { fontSize: 10, color: C.textMute, letterSpacing: "0.06em", fontWeight: 600, marginBottom: 5 };

  return h("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 10,
      flexWrap: "wrap",
      ...style,
    },
  },
    h("div", null,
      title && h("div", { style: { ...lblStyle, color: C.teal, marginBottom: 3 } }, title),
      description && h("div", { style: { fontSize: 11, color: C.textSec } }, description)
    ),
    action
  );
}

export function EmptyState({ icon = "∅", title, description, action, style = {} }) {
  return h("div", {
    style: {
      textAlign: "center",
      padding: "32px 16px",
      color: C.textMute,
      ...style,
    },
  },
    h("div", { style: { fontSize: 28, marginBottom: 8, opacity: 0.6 } }, icon),
    title && h("div", { style: { fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 } }, title),
    description && h("div", { style: { fontSize: 10, lineHeight: 1.6 } }, description),
    action && h("div", { style: { marginTop: 12 } }, action)
  );
}
