/**
 * Route-gate contract · `/e2e/*` harness 的 runtime 可達性。
 *
 * 這支同時鎖兩件事：
 *   1) 純函式判定（hostname allow-list）—— localhost / 合法 preview host = true，
 *      自訂網域、published production、lookalike = false。
 *   2) source contract —— App.tsx 與 harnessRoutes.tsx 不得再用 build-time
 *      `import.meta.env.DEV` 當唯一 gate（會讓 Hosted Preview 被 tree-shake 成 404），
 *      且 harness route 只能掛在 `harnessRoutesEnabled()` 後面。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import {
  isHarnessHostAllowed,
  isPreviewHost,
  isLocalHost,
  harnessRoutesEnabled,
  PREVIEW_HOST_RE,
} from '@/routes/harnessHostGate';
import { HarnessRouteGuard } from '@/routes/harnessRoutes';

const ALLOW = [
  'localhost',
  '127.0.0.1',
  'preview--wise-traders-hub.lovable.app',
  'preview--0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovable.app',
];

const DENY = [
  // 自訂網域
  'legendflow.tw',
  'www.legendflow.tw',
  // published production
  'wise-traders-hub.lovable.app',
  '0.0.0.0',
  '[::1]',
  'dev.localhost',
  'id-preview--0f5bdae6.lovable.app', // 非 preview-- 開頭
  // lookalike / suffix 注入
  'preview--x.lovable.app.evil.com',
  'evil.com/preview--x.lovable.app',
  'xpreview--a.lovable.app',
  'preview--a.lovable.app.',
  'preview--a.lovable.appx',
  'preview--a.lovable-app.com',
  'preview--a.notlovable.app',
  'sub.preview--a.lovable.app',
  'preview--UPPER.lovable.app'.replace('UPPER', 'a/b'),
  '',
];

describe('harness host gate · 純函式判定', () => {
  it.each(ALLOW)('allow: %s', (h) => {
    expect(isHarnessHostAllowed(h)).toBe(true);
  });

  it.each(DENY)('deny: %s', (h) => {
    expect(isHarnessHostAllowed(h)).toBe(false);
  });

  it('localhost 與 preview host 兩條件互相獨立', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('preview--a.lovable.app')).toBe(false);
    expect(isPreviewHost('preview--a.lovable.app')).toBe(true);
    expect(isPreviewHost('localhost')).toBe(false);
  });

  it('regex 完全錨定（前後皆不可延伸）', () => {
    expect(PREVIEW_HOST_RE.source.startsWith('^')).toBe(true);
    expect(PREVIEW_HOST_RE.source.endsWith('$')).toBe(true);
  });

  it('大小寫不敏感（瀏覽器 hostname 已小寫，仍防呆）', () => {
    expect(isHarnessHostAllowed('PREVIEW--Wise-Traders-Hub.LOVABLE.APP')).toBe(true);
    expect(isHarnessHostAllowed('LEGENDFLOW.TW')).toBe(false);
  });
});

describe('harness host gate · runtime gate 行為', () => {
  it('vitest（DEV/test）下為 true', () => {
    expect(harnessRoutesEnabled()).toBe(true);
  });

  it('非 DEV 時完全由 hostname 決定（以純函式代理驗證 production host 不 mount）', () => {
    // production/custom hostname 一律不得放行 → App.tsx 的 HARNESS_ENABLED 為 false
    for (const h of ['legendflow.tw', 'www.legendflow.tw', 'wise-traders-hub.lovable.app']) {
      expect(isHarnessHostAllowed(h)).toBe(false);
    }
  });

  it.each(['legendflow.tw', 'www.legendflow.tw', 'wise-traders-hub.lovable.app', 'preview--x.lovable.app.evil.com'])(
    '非 allowlisted host element 必定 render NotFound: %s',
    (hostname) => {
      render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            HarnessRouteGuard,
            { hostname },
            createElement('div', { 'data-testid': 'harness-loaded' }, 'loaded'),
          ),
        ),
      );
      expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
      expect(screen.queryByTestId('harness-loaded')).not.toBeInTheDocument();
    },
  );

  it.each(['localhost', '127.0.0.1', 'preview--wise-traders-hub.lovable.app'])(
    'allowlisted runtime host 可載入 element: %s',
    (hostname) => {
      render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            HarnessRouteGuard,
            { hostname },
            createElement('div', { 'data-testid': 'harness-loaded' }, 'loaded'),
          ),
        ),
      );
      expect(screen.getByTestId('harness-loaded')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '404' })).not.toBeInTheDocument();
    },
  );
});

describe('harness host gate · source contract', () => {
  it('App.tsx 無條件註冊 harness routes，不使用 module-top-level gate', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(src).toContain('{harnessRoutes()}');
    expect(src).toContain('{portfolioHarnessRoutes()}');
    expect(src).not.toMatch(/HARNESS_ENABLED|harnessRoutesEnabled/);
    expect(src).not.toMatch(/\?\s*(harnessRoutes|portfolioHarnessRoutes)\(\)\s*:\s*null/);
  });

  it('目標 path 無條件存在，guard 在 element 且 lazy import 不受頂層條件控制', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/routes/harnessRoutes.tsx'), 'utf8');
    expect(src).toContain('path="/e2e/holdings-detail-panel-volume"');
    expect(src).toContain('element={guarded(<HoldingsDetailPanelVolumeHarnessEntry />)}');
    expect(src).toContain('window.location.hostname');
    expect(src).not.toMatch(/const\s+(DEV|HARNESS_ENABLED)\s*=/);
    expect(src).not.toMatch(/\?\s*lazy\(\(\)\s*=>\s*import/);
  });

  it('gate 不吃 query string（stage2 等旗標不得出現在 gate 模組）', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/routes/harnessHostGate.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/search|URLSearchParams|stage2|token|header/i);
  });
});
