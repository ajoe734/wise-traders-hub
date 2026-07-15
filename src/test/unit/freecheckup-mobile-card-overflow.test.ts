import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Mobile QA: Free Checkup 卡片在 320 / 340 / 375 / 414px 寬度下的
 * ROI、% 與 TODAY/VALUE 雙區塊不擠壓、不溢出卡片邊界。
 *
 * jsdom 不執行佈局，因此本測試以「CSS 規則 + 內聯樣式存在性」作為靜態合約驗證：
 *  - 全域：white-space:nowrap、overflow:hidden、min-width:0、ellipsis
 *  - 各斷點 media query 至少包含對應寬度（含等於該寬度時生效）
 *  - 數字採用 tabular-nums / tnum 確保 baseline 對齊
 */

let SRC = '';

beforeAll(() => {
  // E-Maint-R5 (holdings audit 2026-05 第二輪): 統一 CSS 來源為
  // src/checkup/styles/holdingsTab.css（可被 PostCSS 壓縮、不每次 render 重建 text node）。
  // 測試需要同時掃描：jsx inline <style>（Hero RWD）+ holdingsTab.css（卡片 RWD）。
  const main = readFileSync(resolve(__dirname, '../../pages/FreeCheckup.jsx'), 'utf8');
  const card = readFileSync(
    resolve(__dirname, '../../checkup/components/freecheckup/HoldingCard.tsx'),
    'utf8'
  );
  const cardReturn = readFileSync(
    resolve(__dirname, '../../checkup/components/freecheckup/_ui/holdingCard/HoldingCardReturn.tsx'),
    'utf8'
  );
  const cardFooter = readFileSync(
    resolve(__dirname, '../../checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx'),
    'utf8'
  );
  const tab = readFileSync(
    resolve(__dirname, '../../checkup/components/freecheckup/HoldingsTab.tsx'),
    'utf8'
  );
  const holdingsCss = readFileSync(
    resolve(__dirname, '../../checkup/styles/holdingsTab.css'),
    'utf8'
  );
  SRC = main
    + '\n/* === HoldingCard.tsx === */\n' + card
    + '\n/* === HoldingCardReturn.tsx === */\n' + cardReturn
    + '\n/* === HoldingCardFooter.tsx === */\n' + cardFooter
    + '\n/* === HoldingsTab.tsx === */\n' + tab
    + '\n/* === holdingsTab.css === */\n<style>{`' + holdingsCss + '`}</style>';
});

// 萃取 <style>{`...`}</style> 內所有 CSS 字串，方便正則檢查
function getAllCss(): string {
  const matches = [...SRC.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)];
  return matches.map((m) => m[1]).join('\n');
}

// 把 CSS 切成 { selectorAtRuleHeader, body } 區塊
function getMediaBlocks(css: string): { header: string; body: string }[] {
  const blocks: { header: string; body: string }[] = [];
  const re = /@media\s*\(([^)]+)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push({ header: m[1].trim(), body: css.slice(start, i - 1) });
  }
  return blocks;
}

// 解析 max-width: Npx
function maxWidthOf(header: string): number | null {
  const m = header.match(/max-width:\s*(\d+)px/);
  return m ? parseInt(m[1], 10) : null;
}

// 取得「在指定 viewport 寬度下會生效」的 media block bodies（合併套用順序）
function effectiveCssAt(viewport: number): string {
  const css = getAllCss();
  const blocks = getMediaBlocks(css);
  const applied = blocks
    .filter((b) => {
      const mw = maxWidthOf(b.header);
      return mw !== null && viewport <= mw;
    })
    // 依 max-width 由大到小套用，越窄的後生效（覆蓋）
    .sort((a, b) => (maxWidthOf(b.header)! - maxWidthOf(a.header)!));
  return applied.map((b) => b.body).join('\n');
}

describe('Free Checkup: 卡片靜態防擠壓合約', () => {
  it('全域 .wb-roi 套用 nowrap + overflow:hidden + max-width:100%', () => {
    const css = getAllCss();
    expect(css).toMatch(/\.wb-card\s+\.wb-roi\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.wb-card\s+\.wb-roi\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.wb-card\s+\.wb-roi\s*\{[^}]*max-width:\s*100%/);
  });

  it('全域 .wb-bottom 具 min-width:0 + 子元素可截斷（DESIGN_HANDOFF §3.4 步驟 4：中文一行）', () => {
    const css = getAllCss();
    expect(css).toMatch(/\.wb-card\s+\.wb-bottom\b[^{]*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(
      /\.wb-card\s+\.wb-bottom\s*>\s*span\s*\{[^}]*overflow:\s*hidden/
    );
  });

  it('今日/市值 數值套用 ellipsis + nowrap', () => {
    const css = getAllCss();
    expect(css).toMatch(
      /\.wb-card\s+\.wb-bottom-val\s*\{[\s\S]*?white-space:\s*nowrap/
    );
    expect(css).toMatch(
      /\.wb-card\s+\.wb-bottom-val\s*\{[\s\S]*?text-overflow:\s*ellipsis/
    );
  });

  it('ROI 內聯樣式採用 tabular-nums 與 clamp 字級', () => {
    expect(SRC).toMatch(/wb-roi/);
    expect(SRC).toMatch(/fontSize:\s*'clamp\(/);
    expect(SRC).toMatch(/tabular-nums/);
  });

  it('Sparkline 在 ≤380px 隱藏 (避免擠壓 ROI)', () => {
    const css = getAllCss();
    expect(css).toMatch(
      /@media\s*\(max-width:\s*380px\)[\s\S]*?\.wb-spark[\s\S]*?display:\s*none/
    );
  });
});

describe.each([
  { name: '320px (iPhone SE 1st)', vw: 320 },
  { name: '340px (極窄安全線)', vw: 340 },
  { name: '375px (iPhone X/12 mini)', vw: 375 },
  { name: '414px (iPhone Plus/Pro Max)', vw: 414 },
])('Mobile QA @ $name', ({ vw }) => {
  it('卡片網格塌成單欄 (≤640) 或保持安全寬度', () => {
    const css = effectiveCssAt(vw);
    if (vw <= 640) {
      expect(css).toMatch(
        /\.holdings-card-grid\s*\{[^}]*grid-template-columns:\s*1fr/
      );
    }
  });

  it('ROI 與 % 不換行 (繼承全域 nowrap 規則)', () => {
    const css = effectiveCssAt(vw);
    expect(css).not.toMatch(/\.wb-roi[^{}]*\{[^}]*white-space:\s*normal/);
    expect(css).not.toMatch(/\.wb-roi[^{}]*\{[^}]*white-space:\s*wrap/);
  });

  it('§3.4：ROI 走 inline clamp(18-22px)，不再依斷點覆蓋（feature 變體已移除）', () => {
    // §3.4 定案後 ROI 全部同尺寸 clamp(18px, 1.4vw + 12px, 22px)，且卡片不再套用 feature 變體樣式。
    if (vw <= 340) {
      const css = effectiveCssAt(vw);
      expect(css).not.toMatch(/\.wb-card\s+\.wb-roi\s*\{[^}]*font-size:\s*clamp\(28px/);
      expect(css).not.toMatch(/\.wb-card-feature\s+\.wb-roi\s*\{[^}]*font-size:\s*clamp\(32px/);
    }
    // ROI 的 clamp 由 HoldingCardReturn.tsx inline style 提供。
    expect(SRC).toMatch(/fontSize:\s*'clamp\(18px,\s*1\.4vw\s*\+\s*12px,\s*22px\)'/);
  });

  it('今日/市值 數值字級在小螢幕受 clamp 控制', () => {
    if (vw <= 640) {
      const css = effectiveCssAt(vw);
      expect(css).toMatch(/\.wb-bottom-val\s*\{[^}]*font-size:\s*clamp\(/);
    }
  });

  it('≤340px footer 強制 ellipsis + overflow:hidden + 縮小 column-gap', () => {
    if (vw <= 340) {
      const css = effectiveCssAt(vw);
      expect(css).toMatch(/\.wb-bottom\s*\{[^}]*max-width:\s*100%/);
      expect(css).toMatch(/\.wb-bottom\s*\{[^}]*overflow:\s*hidden/);
      expect(css).toMatch(/\.wb-bottom\s*\{[^}]*column-gap:\s*[0-6]px/);
      expect(css).toMatch(
        /\.wb-bottom\s*>\s*span\s*\{[\s\S]*?text-overflow:\s*ellipsis/
      );
    }
  });
});

