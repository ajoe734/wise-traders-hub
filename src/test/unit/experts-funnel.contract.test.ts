/**
 * /experts 契約測試（v2.1 Phase 3 補漏輪）：
 *  1) 公開文案禁用字 0（T+7、下週出手、保證、目標價）。
 *  2) ExpertCard 只有一個 expert CTA，文字「查看老師」，href=/expert/:slug（無 #plans）。
 *  3) CTA 使用 preserveUtm 保留白名單 UTM。
 *  4) 角色說明是可展開 disclosure，mobile 預設收合（ARIA 由 Radix Collapsible 提供）。
 *  5) 不得用 overflow-x hidden/clip 掩蓋溢出。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preserveUtm } from '@/lib/preserveUtm';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const EXPERTS = read('src/pages/Experts.tsx');
const CARD = read('src/components/ExpertCard.tsx');
const ALL = [EXPERTS, CARD];

const BANNED = ['T+7', '下週出手', '保證', '目標價', '推薦下單'];

describe('/experts copy compliance', () => {
  it('禁用字 0', () => {
    for (const s of ALL) for (const b of BANNED) expect(s).not.toContain(b);
  });

  it('mentor 說明改為中性公開機制語句', () => {
    expect(EXPERTS).toContain('每週固定週次公開');
    expect(EXPERTS).toContain('教學研究用途，非買賣建議');
  });

  it('不得用 overflow-x hidden/clip 遮蔽溢出', () => {
    for (const s of ALL) expect(s).not.toMatch(/overflow-x-(hidden|clip)/);
  });
});

describe('ExpertCard single CTA', () => {
  it('只有一個 CTA，文字為「查看老師」', () => {
    expect(CARD).toContain('查看老師');
    expect(CARD).not.toContain('查看介紹');
    expect(CARD).not.toContain('查看方案');
    const links = CARD.match(/<Link\b/g) ?? [];
    expect(links).toHaveLength(1);
  });

  it('CTA 指向 /expert/:slug，不得帶 #plans', () => {
    expect(CARD).toContain('`/expert/${person.slug}`');
    expect(CARD).not.toContain('#plans');
  });

  it('CTA 用 preserveUtm 包裝', () => {
    expect(CARD).toMatch(/to=\{preserveUtm\(`\/expert\/\$\{person\.slug\}`, search\)\}/);
  });

  it('preserveUtm 保留白名單 UTM 參數', () => {
    const out = preserveUtm('/expert/abc', '?utm_source=ig&utm_medium=bio&utm_campaign=aug&foo=bar');
    expect(out).toContain('utm_source=ig');
    expect(out).toContain('utm_medium=bio');
    expect(out).toContain('utm_campaign=aug');
    expect(out).not.toContain('foo=bar');
  });
});

describe('/experts role disclosure', () => {
  it('使用 Collapsible 且標題為「角色與服務差異」', () => {
    expect(EXPERTS).toContain('CollapsibleTrigger');
    expect(EXPERTS).toContain('CollapsibleContent');
    expect(EXPERTS).toContain('角色與服務差異');
    expect(EXPERTS).toContain('data-testid="roles-disclosure-trigger"');
  });

  it('預設狀態由 min-width:768 決定（mobile 收合）', () => {
    expect(EXPERTS).toContain("window.matchMedia('(min-width: 768px)').matches");
  });
});
