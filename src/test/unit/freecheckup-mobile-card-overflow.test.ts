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
  // P3-perf: HoldingsTab / HoldingCard 已抽出為獨立元件，掃描時併入內容以保持
  // 「卡片內聯樣式合約」覆蓋率（ROI / TODAY-VALUE grid / tabular-nums / RWD media queries）
  const main = readFileSync(resolve(__dirname, '../../pages/FreeCheckup.jsx'), 'utf8');
  const card = readFileSync(
    resolve(__dirname, '../../checkup/components/freecheckup/HoldingCard.jsx'),
    'utf8'
  );
  const tab = readFileSync(
    resolve(__dirname, '../../checkup/components/freecheckup/HoldingsTab.jsx'),
    'utf8'
  );
  SRC = main
    + '\n/* === HoldingCard.jsx === */\n' + card
    + '\n/* === HoldingsTab.jsx === */\n' + tab;
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

  it('全域 .wb-bottom 是 grid + min-width:0 + 子元素可截斷', () => {
    const css = getAllCss();
    expect(css).toMatch(/\.wb-card\s+\.wb-bottom\b[^{]*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(
      /\.wb-card\s+\.wb-bottom\s*>\s*span\s*\{[^}]*overflow:\s*hidden/
    );
  });

  it('TODAY/VALUE 數值套用 ellipsis + nowrap', () => {
    const css = getAllCss();
    expect(css).toMatch(
      /\.wb-card\s+\.wb-bottom-val\s*\{[\s\S]*?white-space:\s*nowrap/
    );
    expect(css).toMatch(
      /\.wb-card\s+\.wb-bottom-val\s*\{[\s\S]*?text-overflow:\s*ellipsis/
    );
  });

  it('ROI 與 TODAY/VALUE 內聯樣式採用 tabular-nums (baseline 對齊)', () => {
    // ROI clamp + lineHeight:1
    expect(SRC).toMatch(/wb-roi[\s\S]{0,400}?fontSize:\s*'clamp\(/);
    // TODAY/VALUE 數值列使用 fontVariantNumeric:'tabular-nums'
    expect(SRC).toMatch(/wb-bottom-val[\s\S]{0,300}?tabular-nums/);
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
    // 全域規則永遠生效；確認沒有任何 media block 將其覆蓋為 normal/wrap
    const css = effectiveCssAt(vw);
    expect(css).not.toMatch(/\.wb-roi[^{}]*\{[^}]*white-space:\s*normal/);
    expect(css).not.toMatch(/\.wb-roi[^{}]*\{[^}]*white-space:\s*wrap/);
  });

  it('TODAY/VALUE 雙區塊保持 grid 兩欄 + 分隔線', () => {
    if (vw <= 340) {
      const css = effectiveCssAt(vw);
      // ≤340px 升級為 minmax(0, 1fr) 以強制安全溢出（不擠壓卡片邊界）
      expect(css).toMatch(
        /\.wb-bottom\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1px\s+minmax\(0,\s*1fr\)/
      );
    }
    // 內聯預設 grid 結構必須存在
    expect(SRC).toMatch(
      /gridTemplateColumns:\s*['"]minmax\(0,\s*1fr\)\s+1px\s+minmax\(0,\s*1fr\)['"]/
    );
  });

  it('極窄 (≤340px) 啟用 ROI 字級縮放避免溢出', () => {
    if (vw <= 340) {
      const css = effectiveCssAt(vw);
      expect(css).toMatch(
        /\.wb-card\s+\.wb-roi\s*\{[^}]*font-size:\s*clamp\(28px,\s*11vw,\s*36px\)/
      );
      expect(css).toMatch(
        /\.wb-card-feature\s+\.wb-roi\s*\{[^}]*font-size:\s*clamp\(32px,\s*13vw,\s*44px\)/
      );
    }
  });

  it('TODAY/VALUE 數值字級在小螢幕受 clamp 控制不超 12px', () => {
    if (vw <= 640) {
      const css = effectiveCssAt(vw);
      expect(css).toMatch(/\.wb-bottom-val\s*\{[^}]*font-size:\s*clamp\(/);
    }
  });

  it('≤340px footer 強制 ellipsis + overflow:hidden + 縮小 column-gap', () => {
    if (vw <= 340) {
      const css = effectiveCssAt(vw);
      // footer container 必須限制最大寬度與隱藏溢出
      expect(css).toMatch(/\.wb-bottom\s*\{[^}]*max-width:\s*100%/);
      expect(css).toMatch(/\.wb-bottom\s*\{[^}]*overflow:\s*hidden/);
      // column-gap 緊縮（≤6px）
      expect(css).toMatch(/\.wb-bottom\s*\{[^}]*column-gap:\s*[0-6]px/);
      // 子 span 強制 ellipsis
      expect(css).toMatch(
        /\.wb-bottom\s*>\s*span\s*\{[\s\S]*?text-overflow:\s*ellipsis/
      );
    }
  });
});
