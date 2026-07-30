import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PREVIEW_LIMITS, richHtmlPreview, richHtmlToPlain } from '@/components/SafeRichHtml';

const read = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf8');

describe('richHtmlPreview', () => {
  it('A1-A3: falsy inputs → 空字串', () => {
    expect(richHtmlPreview(null)).toBe('');
    expect(richHtmlPreview(undefined)).toBe('');
    expect(richHtmlPreview('')).toBe('');
  });

  it('A4: 未超上限的純文字原樣回傳、不加省略號', () => {
    expect(richHtmlPreview('hello', 200)).toBe('hello');
    expect(richHtmlPreview('hello', 200)).not.toContain('…');
  });

  it('A5: 超過上限則截斷並加 …', () => {
    const text = 'a'.repeat(20);
    const out = richHtmlPreview(text, 10);
    expect(out).toBe('a'.repeat(10) + '…');
    expect(out.length).toBe(11);
    expect(out.endsWith('…')).toBe(true);
  });

  it('A6: 剝除 <p> 標籤', () => {
    const out = richHtmlPreview('<p>abc</p><p>def</p>', 200);
    expect(out).toMatch(/^abc\s?def$/);
    expect(out).not.toContain('<');
  });

  it('A7: 剝除 strong/em/br/ul/li 等富文字標籤', () => {
    const html = '<p><strong>粗</strong><em>斜</em></p><ul><li>一</li><li>二</li></ul><br>尾';
    const out = richHtmlPreview(html, 200);
    expect(out).not.toContain('<');
    expect(out).toContain('粗');
    expect(out).toContain('斜');
    expect(out).toContain('一');
    expect(out).toContain('二');
    expect(out).toContain('尾');
  });

  it('A8: 移除開頭 • / · 條列符', () => {
    expect(richHtmlPreview('• 第一項', 200)).toBe('第一項');
    expect(richHtmlPreview('· 另一項', 200)).toBe('另一項');
  });

  it('A9: 多重空白 collapse 成單一空白', () => {
    expect(richHtmlPreview('a  \n\t b', 200)).toBe('a b');
  });

  it('A10: 剛好等於 maxLen 不加 …', () => {
    const text = 'x'.repeat(50);
    expect(richHtmlPreview(text, 50)).toBe(text);
    expect(richHtmlPreview(text, 50)).not.toContain('…');
  });

  it('A11: maxLen+1 觸發截斷', () => {
    const text = 'x'.repeat(51);
    const out = richHtmlPreview(text, 50);
    expect(out.length).toBe(51);
    expect(out.endsWith('…')).toBe(true);
  });

  it('A12: 預設 maxLen=200', () => {
    expect(richHtmlPreview('x'.repeat(200))).toBe('x'.repeat(200));
    const out = richHtmlPreview('x'.repeat(201));
    expect(out.length).toBe(201);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('richHtmlToPlain', () => {
  it('B1: falsy → 空字串', () => {
    expect(richHtmlToPlain(null)).toBe('');
    expect(richHtmlToPlain(undefined)).toBe('');
    expect(richHtmlToPlain('')).toBe('');
  });

  it('B2: 5000 字純文字完整回傳，不截斷', () => {
    const text = 'a'.repeat(5000);
    const out = richHtmlToPlain(text);
    expect(out.length).toBe(5000);
    expect(out).not.toContain('…');
  });

  it('B3: HTML 標籤全部剝除', () => {
    const out = richHtmlToPlain('<p><strong>粗</strong>字</p>');
    expect(out).toBe('粗字');
    expect(out).not.toContain('<');
  });

  it('B4: <br> 多段內容完整保留', () => {
    const out = richHtmlToPlain('第一段<br>第二段<br>第三段');
    expect(out).toContain('第一段');
    expect(out).toContain('第二段');
    expect(out).toContain('第三段');
    expect(out).not.toContain('<');
  });

  it('B5: 移除條列前綴', () => {
    expect(richHtmlToPlain('• 條列前綴')).toBe('條列前綴');
  });

  it('B6: 多空白 collapse', () => {
    expect(richHtmlToPlain('a\n\n\n b')).toBe('a b');
  });
});

describe('PREVIEW_LIMITS 常數凍結', () => {
  it('數值需與商業定義一致，改動請同步更新測試與所有呼叫端', () => {
    expect(PREVIEW_LIMITS).toEqual({
      cardTitle: 80,
      cardSummary: 220,
      listRow: 140,
      dashboardRow: 100,
      riskNoteShort: 60,
      learningPointsCard: 500,
      learningPointsPreview: 1000,
    });
  });
});

describe('呼叫端規則對齊（靜態原始碼掃描）', () => {
  type Rule = { file: string; must: RegExp[]; label: string };
  const rules: Rule[] = [
    {
      label: 'JournalCard: title/summary/learning_points 使用 PREVIEW_LIMITS',
      file: 'src/components/JournalCard.tsx',
      must: [
        /richHtmlPreview\([^,]+reason_summary[^,]*,\s*PREVIEW_LIMITS\.cardTitle\)/,
        /richHtmlPreview\([^,]+reason_detail[^,]*,\s*PREVIEW_LIMITS\.cardSummary\)/,
        /richHtmlPreview\([^,]+learning_points[^,]*,\s*PREVIEW_LIMITS\.learningPointsCard\)/,
      ],
    },
    {
      label: 'Signals: reason_summary=listRow, risk_notes=riskNoteShort',
      file: 'src/pages/app/Signals.tsx',
      must: [
        /richHtmlPreview\([^,]+reason_summary[^,]*,\s*PREVIEW_LIMITS\.listRow\)/,
        /richHtmlPreview\([^,]+risk_notes[^,]*,\s*PREVIEW_LIMITS\.riskNoteShort\)/,
      ],
    },
    {
      label: 'SignalsDashboard: reason_summary=dashboardRow',
      file: 'src/pages/app/SignalsDashboard.tsx',
      must: [/richHtmlPreview\([^,]+reason_summary[^,]*,\s*PREVIEW_LIMITS\.dashboardRow\)/],
    },
    {
      label: 'SignalRow VM: reason_summary=cardTitle',
      file: 'src/pages/_adminSignals/useSignalRowViewModel.ts',
      must: [/richHtmlPreview\([^,]+reason_summary[^,]*,\s*PREVIEW_LIMITS\.cardTitle\)/],
    },
  ];

  for (const r of rules) {
    it(`${r.label}`, () => {
      const src = read(r.file);
      for (const re of r.must) {
        expect(src, `${r.file} 缺少匹配 ${re}`).toMatch(re);
      }
      // 禁止用魔數：richHtmlPreview(x, 123)
      expect(src, `${r.file} 內仍有裸數字上限（請改用 PREVIEW_LIMITS）`).not.toMatch(
        /richHtmlPreview\([^)]*,\s*\d+\s*\)/,
      );
    });
  }

  it('JournalDetail 詳情頁不得再使用 richHtmlPreview（一律 richHtmlToPlain）', () => {
    // A6：詳情頁已拆成 `_journalDetail/`，守衛需涵蓋整個模組。
    const src = [
      'src/pages/app/JournalDetail.tsx',
      'src/pages/app/_journalDetail/richHtml.ts',
      'src/pages/app/_journalDetail/TradeItem.tsx',
      'src/pages/app/_journalDetail/TeachingDebugBadge.tsx',
    ].map(read).join('\n');
    expect(src).not.toMatch(/richHtmlPreview\s*\(/);
    expect(src).toMatch(/richHtmlToPlain\s*\(/);
  });

  it('JournalPreviewDialog 預覽 dialog 不得再使用 richHtmlPreview', () => {
    const src = read('src/pages/_signalEditor/JournalPreviewDialog.tsx');
    expect(src).not.toMatch(/richHtmlPreview\s*\(/);
    expect(src).toMatch(/richHtmlToPlain\s*\(/);
  });
});
