import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // DemoBanner / DemoCTA 已於 §6 精簡時刪除；禁止再次以識別符 / import / JSX 形式引入。
      // 反向斷言（測試 count===0）走 scripts/check-no-demo-artifacts.mjs 的 ALLOWLIST。
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name=/^(DemoBanner|DemoCTA|demoBanner|demoCTA)$/]",
          message: "DemoBanner / DemoCTA 已停用並刪除，禁止重新引入（見 scripts/check-no-demo-artifacts.mjs）。",
        },
        {
          selector: "JSXIdentifier[name=/^(DemoBanner|DemoCTA)$/]",
          message: "DemoBanner / DemoCTA 已停用並刪除，禁止重新引入（見 scripts/check-no-demo-artifacts.mjs）。",
        },
        {
          selector: "Literal[value=/(^|[^a-zA-Z])--demo-[a-z0-9-]+/]",
          message: "CSS token `--demo-*` 已隨 DemoBanner/DemoCTA 一併退場，禁止再引入。",
        },
      ],
    },
    },
);
