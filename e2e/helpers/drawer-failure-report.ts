/**
 * Drawer failure reporter — 抽屜相關 E2E 共用失敗回放輔助
 *
 * 效果：
 *   1. 為每支 spec 在 fail 時自動 attach viewport / project / URL / step trail 摘要
 *   2. 於 console 印出「回放指令」，含 trace.zip / video.webm / screenshot 的絕對路徑
 *      讓終端可直接 `bunx playwright show-trace <path>` 或雙擊播放
 *   3. 提供 `drawerStep(page, name, fn)` 包裝：所有關鍵步驟以 `test.step` 記錄，
 *      Playwright trace timeline 會標出是哪個斷點的哪個步驟出錯
 *
 * 產物實體路徑：
 *   test-results/holdings-drawer/<project>/<test-slug>/
 *     ├─ trace.zip         （retain-on-failure）
 *     ├─ video.webm        （retain-on-failure）
 *     └─ test-failed-*.png （only-on-failure）
 */
import { test, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { getOverflowAnnotations } from './drawer-overflow-annotate';

type StepFn<T> = () => Promise<T> | T;

const stepTrail = new WeakMap<object, string[]>();

/** 追蹤當前 test 的步驟軌跡（用 testInfo 當 key）*/
function pushStep(testInfoLike: object, label: string) {
  const arr = stepTrail.get(testInfoLike) ?? [];
  arr.push(label);
  stepTrail.set(testInfoLike, arr);
}

/**
 * 包裝關鍵步驟為 test.step + 步驟軌跡記錄
 * 失敗時 attach 的 step trail 會標出「卡在哪一步」
 */
export async function drawerStep<T>(label: string, fn: StepFn<T>): Promise<T> {
  return test.step(label, async () => {
    const testInfo = test.info();
    pushStep(testInfo, label);
    return fn();
  });
}

/**
 * 於任一抽屜 spec 內呼叫，註冊 afterEach 自動輸出回放資訊
 * 用法：檔頭 import 後直接呼叫 `registerDrawerFailureReport()` 即可
 */
export function registerDrawerFailureReport() {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;

    const viewport = page.viewportSize();
    const project = testInfo.project.name;
    const url = page.url();
    const trail = stepTrail.get(testInfo) ?? [];
    const lastStep = trail[trail.length - 1] ?? '(no step recorded)';

    const summary = [
      `TEST FAILED · ${testInfo.title}`,
      `project      : ${project}`,
      `viewport     : ${viewport ? `${viewport.width}x${viewport.height}` : 'unknown'}`,
      `current URL  : ${url}`,
      `last step    : ${lastStep}`,
      `step trail   :`,
      ...trail.map((s, i) => `  ${i + 1}. ${s}`),
    ].join('\n');

    await testInfo.attach('drawer-failure-summary', {
      body: summary,
      contentType: 'text/plain',
    });

    // 收集實體回放檔（trace / video / screenshot）— retain-on-failure 由全域 config 控制，
    // 這裡再列出實際落地路徑，方便使用者直接複製指令回放
    const outDir = testInfo.outputDir;
    const files: string[] = [];
    if (fs.existsSync(outDir)) {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(outDir);
    }
    const trace = files.find((f) => f.endsWith('.zip'));
    const video = files.find((f) => f.endsWith('.webm'));
    const shots = files.filter((f) => f.endsWith('.png'));

    // 印到終端 — 一眼看到是哪個斷點/哪個步驟 + 直接可執行的回放指令
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '════════════════════════════════════════════════════════════════',
        `[drawer-failure] ${project} · ${testInfo.title}`,
        `  viewport   : ${viewport ? `${viewport.width}x${viewport.height}` : 'unknown'}`,
        `  last step  : ${lastStep}`,
        `  output dir : ${outDir}`,
        trace ? `  ▶ trace    : bunx playwright show-trace "${trace}"` : '  ▶ trace    : (missing)',
        video ? `  ▶ video    : ${video}` : '  ▶ video    : (missing)',
        shots.length ? `  ▶ screenshot: ${shots.join('\n                 ')}` : '  ▶ screenshot: (missing)',
        '════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  });
}

/** 導出 page 型別便利化 spec 端 import */
export type { Page };
