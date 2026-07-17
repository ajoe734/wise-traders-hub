/**
 * Drawer overflow annotator — E2E 失敗時的視覺化定位輔助
 *
 * 給定 audit 產出的 findings（含 boundingClientRect + rootBox + overflowAmount），
 * 於頁面上直接繪製覆蓋層：
 *   - 綠色虛線：panel（root）邊界，附上 L / R / W 數值
 *   - 紅色實框：從「左側」出界的節點；橘色實框：從「右側」出界的節點
 *   - 每筆標註：側別（LEFT/RIGHT）、overflow 像素、kind、tag、內文片段
 *   - 於 panel 邊界（rootLeft / rootRight）畫垂直虛線，一眼看是哪一側越界
 *
 * 之後截圖並 attach 到 testInfo，命名 `overflow-annotated-<label>.png`，
 * 並額外 attach `overflow-findings-<label>.json` 給機器可讀分析。
 *
 * 覆蓋層加完 → 截圖 → 立即移除，避免影響 retry / 後續斷言。
 */
import type { Page, Locator, TestInfo } from '@playwright/test';

export type OverflowFinding = {
  kind: 'element' | 'text';
  tag?: string;
  text: string;
  left: number;
  right: number;
  top?: number;
  bottom?: number;
  rootLeft: number;
  rootRight: number;
  overflow: number;
};

type AnnotatedFinding = OverflowFinding & { side: 'left' | 'right' };

function withSide(f: OverflowFinding): AnnotatedFinding {
  const leftOver = f.rootLeft - f.left;
  const rightOver = f.right - f.rootRight;
  return { ...f, side: leftOver > rightOver ? 'left' : 'right' };
}

export async function annotateOverflowAndAttach(
  page: Page,
  panel: Locator,
  findings: OverflowFinding[],
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  if (!findings || findings.length === 0) return;
  const annotated = findings.map(withSide);

  await panel.evaluate((root, args) => {
    const { boxes } = args as { boxes: AnnotatedFinding[] };
    const rootBox = root.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.id = '__drawer_overflow_annotate_layer__';
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

    const rootOutline = document.createElement('div');
    rootOutline.style.cssText =
      `position:fixed;left:${rootBox.left}px;top:${rootBox.top}px;` +
      `width:${rootBox.width}px;height:${rootBox.height}px;` +
      'outline:2px dashed #10b981;background:transparent;';
    layer.appendChild(rootOutline);

    const rootLabel = document.createElement('div');
    rootLabel.textContent =
      `PANEL  L=${rootBox.left.toFixed(1)}  R=${rootBox.right.toFixed(1)}  ` +
      `T=${rootBox.top.toFixed(1)}  B=${rootBox.bottom.toFixed(1)}  W=${rootBox.width.toFixed(1)}`;
    rootLabel.style.cssText =
      `position:fixed;left:${rootBox.left}px;top:${Math.max(0, rootBox.top - 18)}px;` +
      'background:#10b981;color:#fff;font:11px/1.2 monospace;padding:2px 4px;';
    layer.appendChild(rootLabel);

    // 左右邊界垂直虛線 — 對照 panel 的兩側邊
    for (const [x, tone] of [
      [rootBox.left, '#10b981'],
      [rootBox.right, '#10b981'],
    ] as const) {
      const line = document.createElement('div');
      line.style.cssText =
        `position:fixed;left:${x}px;top:0;width:0;height:100vh;` +
        `border-left:1px dashed ${tone};`;
      layer.appendChild(line);
    }

    boxes.forEach((b, idx) => {
      const color = b.side === 'left' ? '#ef4444' : '#f97316';
      const top = b.top ?? rootBox.top;
      const bottom = b.bottom ?? top + 14;
      const w = Math.max(2, b.right - b.left);
      const h = Math.max(6, bottom - top);

      const outline = document.createElement('div');
      outline.style.cssText =
        `position:fixed;left:${b.left}px;top:${top}px;width:${w}px;height:${h}px;` +
        `outline:2px solid ${color};background:${color}22;`;
      layer.appendChild(outline);

      const short = (b.text || '').slice(0, 32).replace(/</g, '&lt;');
      const tag = document.createElement('div');
      tag.textContent =
        `#${idx + 1} ${b.side.toUpperCase()} +${b.overflow.toFixed(2)}px  ` +
        `[${b.kind}${b.tag ? `:${b.tag}` : ''}] "${short}"`;
      const labelX = Math.max(2, Math.min(b.left, window.innerWidth - 320));
      const labelY = Math.max(2, top - 16);
      tag.style.cssText =
        `position:fixed;left:${labelX}px;top:${labelY}px;` +
        `background:${color};color:#fff;font:10px/1.2 monospace;padding:2px 4px;` +
        'max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      layer.appendChild(tag);

      // 從 rect 越界那一側，畫一條粗實線，強調違反的邊
      const boundaryX = b.side === 'left' ? b.rootLeft : b.rootRight;
      const crossX = b.side === 'left' ? b.left : b.right;
      const arrow = document.createElement('div');
      const x1 = Math.min(boundaryX, crossX);
      const x2 = Math.max(boundaryX, crossX);
      arrow.style.cssText =
        `position:fixed;left:${x1}px;top:${top + h / 2 - 1}px;width:${x2 - x1}px;` +
        `height:2px;background:${color};`;
      layer.appendChild(arrow);
    });

    document.body.appendChild(layer);
  }, { boxes: annotated });

  const png = await page.screenshot({ fullPage: false });
  await testInfo.attach(`overflow-annotated-${label}.png`, {
    body: png,
    contentType: 'image/png',
  });
  await testInfo.attach(`overflow-findings-${label}.json`, {
    body: JSON.stringify(annotated, null, 2),
    contentType: 'application/json',
  });

  const lines = annotated.map((b, i) =>
    `  ${i + 1}. ${b.side.toUpperCase().padEnd(5)} +${b.overflow.toFixed(2)}px  ` +
    `[${b.kind}${b.tag ? `:${b.tag}` : ''}] "${b.text.slice(0, 60)}"  ` +
    `rect=(L${b.left.toFixed(1)},R${b.right.toFixed(1)}) ` +
    `root=(L${b.rootLeft.toFixed(1)},R${b.rootRight.toFixed(1)})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `\n[overflow-annotated · ${label}] ${annotated.length} finding(s)\n${lines.join('\n')}\n`,
  );

  await page.evaluate(() => {
    document.getElementById('__drawer_overflow_annotate_layer__')?.remove();
  });
}

/**
 * 便利化封裝：將 audit 結果（含 badBoxes / badTextNodes）合併成統一 findings 列表
 * badBoxes 需含：tag, text, left, right, rootLeft, rootRight, overflow (top/bottom 選填)
 * badTextNodes 需含：text, left, right, rootLeft, rootRight, overflow (top/bottom 選填)
 */
export function mergeAuditFindings(audit: {
  badBoxes?: Array<Omit<OverflowFinding, 'kind'> & { tag?: string }>;
  badTextNodes?: Array<Omit<OverflowFinding, 'kind' | 'tag'>>;
}): OverflowFinding[] {
  const boxes = (audit.badBoxes ?? []).map((b) => ({ ...b, kind: 'element' as const }));
  const texts = (audit.badTextNodes ?? []).map((b) => ({ ...b, kind: 'text' as const }));
  return [...boxes, ...texts];
}
