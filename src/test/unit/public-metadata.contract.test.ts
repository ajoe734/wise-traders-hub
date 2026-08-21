import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Public funnel metadata contract.
 * The user-facing SEO/OG source strings of the public funnel must not carry
 * the retired promises (T+7 cadence, 下週出手, 保證, 目標價).
 * Scope: only the SEO/title/description blocks of the public funnel pages
 * plus index.html head. Legal pages, docs, fixtures and DB data are excluded.
 */
const BANNED = ['T+7', '下週出手', '保證', '目標價'];

const SOURCES = [
  'src/pages/Index.tsx',
  'src/pages/Experts.tsx',
  'src/pages/Pricing.tsx',
  'src/pages/ExpertProfile.tsx',
  'src/components/SEOLite.tsx',
  'src/components/SEO.tsx',
];

function read(p: string) {
  return readFileSync(resolve(process.cwd(), p), 'utf8');
}

/** Extract the `<SEO ... />` blocks (metadata source) from a page file. */
function seoBlocks(src: string): string {
  const out: string[] = [];
  const re = /<SEO\b[\s\S]*?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[0]);
  return out.join('\n');
}

describe('public funnel metadata contract', () => {
  for (const file of SOURCES) {
    it(`${file} SEO metadata carries no retired promise`, () => {
      const src = read(file);
      const block = file.includes('/pages/') ? seoBlocks(src) : src;
      for (const term of BANNED) {
        expect(block, `${file} metadata contains ${term}`).not.toContain(term);
      }
    });
  }

  it('index.html head metadata carries no retired promise', () => {
    const html = read('index.html');
    const head = html.slice(0, html.indexOf('</head>'));
    for (const term of BANNED) {
      expect(head, `index.html head contains ${term}`).not.toContain(term);
    }
  });

  it('home description stays aligned with the body cadence copy', () => {
    const block = seoBlocks(read('src/pages/Index.tsx'));
    expect(block).toContain('每週操作復盤');
    expect(block).toContain('教學研究用途');
  });

  it('advisor realtime wording is preserved on the home page', () => {
    const block = seoBlocks(read('src/pages/Index.tsx'));
    expect(block).toContain('即時策略訊號');
  });
});
