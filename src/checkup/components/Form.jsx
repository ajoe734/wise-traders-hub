import { createElement as h } from "react";
import { C } from "../theme.js";

// ── 通用表單元件 helper ────────────────────────────────────────
const inputBaseStyle = {
  width: "100%",
  background: C.subtle,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  color: C.text,
  fontSize: 12,
  outline: "none",
  fontFamily: "inherit",
};

const textareaBaseStyle = {
  ...inputBaseStyle,
  resize: "vertical",
  minHeight: 68,
  lineHeight: 1.6,
};

export function TextInput({ value, onChange, placeholder, type = "text", style = {}, ...props }) {
  return h("input", {
    type,
    value,
    onChange,
    placeholder,
    style: { ...inputBaseStyle, ...style },
    ...props,
  });
}

export function TextArea({ value, onChange, placeholder, style = {}, ...props }) {
  return h("textarea", {
    value,
    onChange,
    placeholder,
    style: { ...textareaBaseStyle, ...style },
    ...props,
  });
}
