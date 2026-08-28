import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const NIX_CHROMIUM =
  '/nix/store/nw961dvpvik5m19kbay4cg27wxgl3sdv-playwright-chromium-headless-shell/chrome-linux/headless_shell';
const RESOLVED_CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined);

/**
 * Stage2 production-like gate：先 production build，再由 vite preview 服務 dist。
 * localhost 是 runtime allowlist；build 內 import.meta.env.DEV === false。
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /holdings-sparkline-boundary\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    launchOptions: RESOLVED_CHROMIUM ? { executablePath: RESOLVED_CHROMIUM } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run build && bunx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});