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

    // Overflow annotations（annotateOverflowAndAttach 每次呼叫都會 push 一筆）
    const overflows = getOverflowAnnotations(testInfo);
    const overflowLines: string[] = [];
    if (overflows.length > 0) {
      overflowLines.push('', 'overflow annotations:');
      overflowLines.push(
        `  count = ${overflows.length}   ` +
          `worst = ${Math.max(...overflows.map((o) => o.maxOverflow)).toFixed(2)}px`,
      );
      overflows.forEach((rec, i) => {
        overflowLines.push(
          `  [${i + 1}] label=${rec.label}`,
          `      worst      : ${rec.maxSide.toUpperCase()} +${rec.maxOverflow.toFixed(2)}px  (${rec.count} finding(s))`,
          `      annotated  : ${path.relative(testInfo.outputDir, rec.pngPath)}`,
          `      findings   : ${path.relative(testInfo.outputDir, rec.jsonPath)}`,
        );
        // 前 3 筆詳細 rect（超過折疊）
        rec.findings.slice(0, 3).forEach((b, j) => {
          overflowLines.push(
            `        - #${j + 1} ${b.side.toUpperCase().padEnd(5)} +${b.overflow.toFixed(2)}px  ` +
              `[${b.kind}${b.tag ? `:${b.tag}` : ''}] "${(b.text || '').slice(0, 48)}"`,
          );
        });
        if (rec.findings.length > 3) {
          overflowLines.push(`        … +${rec.findings.length - 3} more (見 ${rec.jsonName})`);
        }
      });
    }

    const summary = [
      `TEST FAILED · ${testInfo.title}`,
      `project      : ${project}`,
      `viewport     : ${viewport ? `${viewport.width}x${viewport.height}` : 'unknown'}`,
      `current URL  : ${url}`,
      `last step    : ${lastStep}`,
      `step trail   :`,
      ...trail.map((s, i) => `  ${i + 1}. ${s}`),
      ...overflowLines,
    ].join('\n');

    // 用 path 屬性 attach → Playwright 會把檔案落地到 outputDir 且以 hash 名複製
    // 到 attachments/，這樣 CLI 就能直接 `cat test-results/.../drawer-failure-summary.txt`
    // 取到完整內容（body 屬性走 in-memory，CLI reporter 會截斷顯示、且不落地）。
    const summaryTxtPath = testInfo.outputPath('drawer-failure-summary.txt');
    fs.writeFileSync(summaryTxtPath, summary, 'utf8');
    await testInfo.attach('drawer-failure-summary', {
      path: summaryTxtPath,
      contentType: 'text/plain',
    });

    // Markdown 版：Playwright HTML report 對 markdown 有 render，且會把同一 test
    // 內的所有 attachments 並列展示 → 打開 summary 即看得到旁邊 overflow-annotated
    // PNG 與 overflow-findings JSON。這裡再多提供一份含 label / 相對路徑的 md 便於
    // 直接複製檔名到終端 open。
    if (overflows.length > 0) {
      const md = [
        `# Drawer failure · ${testInfo.title}`,
        '',
        `- project: \`${project}\``,
        `- viewport: \`${viewport ? `${viewport.width}x${viewport.height}` : 'unknown'}\``,
        `- last step: ${lastStep}`,
        '',
        '## Overflow annotations',
        '',
        '| # | label | worst side | overflow (px) | findings | annotated PNG | JSON |',
        '|---|-------|------------|---------------|----------|---------------|------|',
        ...overflows.map(
          (r, i) =>
            `| ${i + 1} | \`${r.label}\` | ${r.maxSide.toUpperCase()} | ${r.maxOverflow.toFixed(
              2,
            )} | ${r.count} | \`${r.pngName}\` | \`${r.jsonName}\` |`,
        ),
        '',
        '## Top findings (per label)',
        '',
        ...overflows.flatMap((r) => [
          `### ${r.label}`,
          '',
          ...r.findings.slice(0, 5).map(
            (b, j) =>
              `- #${j + 1} **${b.side.toUpperCase()}** \`+${b.overflow.toFixed(2)}px\` ` +
              `[${b.kind}${b.tag ? `:${b.tag}` : ''}] "${(b.text || '').slice(0, 60).replace(/\|/g, '\\|')}"  ` +
              `rect=(L${b.left.toFixed(1)}, R${b.right.toFixed(1)}) ` +
              `root=(L${b.rootLeft.toFixed(1)}, R${b.rootRight.toFixed(1)})`,
          ),
          r.findings.length > 5 ? `- … +${r.findings.length - 5} more (見 \`${r.jsonName}\`)` : '',
          '',
        ]),
        '> 同一 test 的所有 attachments 已與本檔並列於 Playwright HTML report / trace；',
        '> CLI 直接開圖：`open $(pwd)/' + path.relative(process.cwd(), overflows[0]!.pngPath) + '`',
      ].join('\n');
      const summaryMdPath = testInfo.outputPath('drawer-failure-summary.md');
      fs.writeFileSync(summaryMdPath, md, 'utf8');
      await testInfo.attach('drawer-failure-summary.md', {
        path: summaryMdPath,
        contentType: 'text/markdown',
      });
    }

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
        overflows.length
          ? `  ▶ overflow  : ${overflows.length} annotation(s), worst ${Math.max(...overflows.map((o) => o.maxOverflow)).toFixed(2)}px\n                 ` +
              overflows.map((o) => `${o.label} → ${o.pngPath}`).join('\n                 ')
          : '  ▶ overflow  : (none)',
        '════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  });
}

/** 導出 page 型別便利化 spec 端 import */
export type { Page };
