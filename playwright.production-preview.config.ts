import { defineConfig, devices } from '@playwright/test';

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