/**
 * Stage 3B / S3B-0 baseline test — 持倉數量／成本的唯一資料源
 *
 * 契約（v4.1 §S3B-D）：
 *   1. qty / cost 只能來自使用者自己的 checkup_storage key `pf-holdings-v2`，
 *      不得從籌碼（chips / bsr / institutional）payload 或行情回應推導。
 *   2. 行情缺值時顯示「—」，不得以 0 充當。
 *   3. 真實 qty=0（已出清但仍列示）必須正常顯示 0，不得被當成缺值變「—」。
 *
 * 本檔為 baseline GREEN：S3B 不得讓上述任何一條退化。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const CARD_FILES = [
  'src/checkup/components/freecheckup/HoldingCard.tsx',
  'src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardHeader.tsx',
  'src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx',
  'src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardPriceTrack.tsx',
];

describe('S3B baseline · 持倉 qty/cost 單一資料源', () => {
  it('bootstrap 從 pf-holdings-v2 讀持倉（唯一 storage key）', () => {
    const hits = ['src/hooks/useFreeCheckupBootstrap.js']
      .map((f) => {
        try { return src(f); } catch { return ''; }
      })
      .join('\n');
    expect(hits, 'useFreeCheckupBootstrap 必須存在且引用 pf-holdings-v2').toContain('pf-holdings-v2');
  });

  it('卡片層不得從籌碼／行情 payload 取 qty 或 cost', () => {
    for (const f of CARD_FILES) {
      const s = src(f);
      const bad = [
        /chips[\w.?]*\.(qty|shares|cost)/i,
        /bsr[\w.?]*\.(qty|shares|cost)/i,
        /institutional[\w.?]*\.(qty|shares|cost)/i,
        /quote[\w.?]*\.(qty|shares|cost)/i,
        /payload[\w.?]*\.(qty|shares|cost)/i,
      ];
      for (const re of bad) {
        expect(re.test(s), `${f} 不得以 ${re} 取得持倉數量/成本（唯一來源是 pf-holdings-v2）`).toBe(false);
      }
    }
  });

  it('市值缺值 → 「—」；真實 0 → 「0」（不得混為一談）', () => {
    // HoldingCardFooter 的權威格式化式：h.value?.toLocaleString() || '—'
    const fmt = (v: number | null | undefined) => (v?.toLocaleString() || '—');
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(0)).toBe('0');
    expect(fmt(12345)).toBe(fmt(12345));
    const footer = src('src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx');
    expect(footer, 'Footer 必須維持 `h.value?.toLocaleString() || \'—\'` 的缺值語義')
      .toContain("h.value?.toLocaleString() || '—'");
  });

  it('今日損益缺值時顯示「—」而非 0', () => {
    const footer = src('src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx');
    expect(footer).toContain("hasToday && todayPnlNum != null");
    expect(footer).toMatch(/:\s*'—'/);
  });
});
