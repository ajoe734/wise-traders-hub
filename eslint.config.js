import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Checkup 深模組清單。新增模組時務必同步更新，並在 docs/architecture/holdings-modules.md
// 補上「跨模組互動 3 條路」對應說明。
const CHECKUP_MODULES = ["holdings", "closing", "events", "tradeIO", "research"];

// 手足模組 deep import 阻擋：模組 A 內部不得直接 import 模組 B 的內部檔案或 barrel 深路徑。
// 允許的三條路：URL params / 唯讀 store selector / shell event bus。
const siblingBoundaryConfigs = CHECKUP_MODULES.map((self) => ({
  files: [`src/checkup/modules/${self}/**/*.{ts,tsx,js,jsx}`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: CHECKUP_MODULES.filter((m) => m !== self).flatMap((other) => [
          {
            group: [
              `../${other}`,
              `../${other}/*`,
              `../../${other}`,
              `../../${other}/*`,
              `../../modules/${other}`,
              `../../modules/${other}/*`,
              `@/checkup/modules/${other}`,
              `@/checkup/modules/${other}/*`,
            ],
            message: `禁止跨模組 import：${self} 不得直接依賴手足模組 ${other}。請走 URL params / store selector / shell event bus（見 docs/architecture/holdings-modules.md 與 events-refresh-tdd.md）。`,
          },
        ]),
      },
    ],
  },
}));

// 對「模組外部」的呼叫端：只允許 `@/checkup/modules/<name>` barrel 入口，禁止深挖內部檔案。
const externalBarrelOnlyConfig = {
  files: ["src/**/*.{ts,tsx,js,jsx}"],
  ignores: [
    ...CHECKUP_MODULES.map((m) => `src/checkup/modules/${m}/**`),
    // 允許測試檔以 fs 掃描或 dynamic import 校驗 barrel 結構
    "src/test/**",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: CHECKUP_MODULES.flatMap((m) => [
          {
            group: [
              `@/checkup/modules/${m}/*`,
              `**/checkup/modules/${m}/*`,
            ],
            message: `深模組 ${m} 只能從 barrel（@/checkup/modules/${m}）進入，禁止 deep import 內部檔案。`,
          },
        ]),
      },
    ],
  },
};

// Checkup Gateway seam（ADR-0004）：hooks / 元件層不得直接 import supabase client，
// 一律走 getCheckupGateway()。gateway adapter 自身是唯一例外。
const checkupGatewaySeamConfig = {
  files: ["src/checkup/hooks/**/*.{ts,tsx,js,jsx}", "src/checkup/components/**/*.{ts,tsx,js,jsx}"],
  ignores: ["**/__tests__/**", "**/*.test.*"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/integrations/supabase/client", "**/integrations/supabase/client"],
            message:
              "Checkup Gateway seam（ADR-0004）：hooks / 元件不得直接 import supabase client，請改用 getCheckupGateway()（http / db / auth / realtime / invoke / rpc）。",
          },
        ],
      },
    ],
  },
};

// R5 free surface 收斂（ADR-0005 §7）：模組外部（含 shell）不得深挖
// src/checkup/components/freecheckup/** 實作檔，只能走 @/checkup/modules/<m>/free。
// 例外：freecheckup 自身、五模組內部、harness 入口與測試，外加 shell 自有 UI 兩個檔。
const freeSurfaceConfig = {
  files: ["src/**/*.{ts,tsx,js,jsx}"],
  ignores: [
    "src/checkup/components/freecheckup/**",
    "src/checkup/modules/**",
    "src/test/**",
    "src/pages/*HarnessEntry.tsx",
    "**/__tests__/**",
    "**/*.test.*",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "@/checkup/components/freecheckup/*",
              "**/checkup/components/freecheckup/*",
              "!@/checkup/components/freecheckup/OnboardingOverlay",
              "!@/checkup/components/freecheckup/DemoFooterHint",
            ],
            message:
              "R5（ADR-0005 §7）：freecheckup 實作檔只能透過 @/checkup/modules/<m>/free 進入，禁止深挖。",
          },
        ],
      },
    ],
  },
};

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
  // Checkup 深模組邊界規則（見 docs/architecture/holdings-modules.md）
  ...siblingBoundaryConfigs,
  externalBarrelOnlyConfig,
  checkupGatewaySeamConfig,
  freeSurfaceConfig,

);
