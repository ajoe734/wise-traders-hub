import { test, expect, type Page } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * JournalDetail 標題完整顯示 + 折疊回歸測試
 *
 * 覆蓋案例：
 *   A. 短標題（~30 字）           → 無折疊按鈕，h1 無 line-clamp-2
 *   B. 邊界 80 字                 → 剛好 = 80 不觸發折疊（threshold 為 > 80）
 *   C. 長標題（~300 字）          → 預設折疊、可展開/收合、textContent 完整不含 …
 *   D. 極長 HTML（~800 字，含標籤） → HTML flatten 為純文字、行為正常、無 `<` 字面
 */

const EXPERT = {
  id: 'expert-1',
  slug: 'test-mentor',
  name: '測試導師',
  role: 'mentor',
  avatar_url: null,
} as const;

const SHORT_TITLE = '本週小幅加碼半導體，觀察量能延續性';
const BOUNDARY_TITLE = '本週操作以科技股為主，包含台積電、聯發科與輝達的加減碼調整，實測進場點與停損停利節奏，一二三四五';
const LONG_TITLE = (
  '買一個算力變現的市場預期，而且有看到資金往這邊進駐；此外 Meta 也推出了 AI Agent 大模型 Muse Spark 1.1，' +
  '算力媲美 Anthropic，但售價僅約 1/3，這代表雲端業者對推理需求的定價壓力將持續下降；本週策略上以加碼 '+
  '半導體算力鏈為主軸，包含 TSMC、NVDA、AVGO；同時對消費性電子降低配置以平衡風險，並保留 20% 現金因應盤中回檔。'
);
const LONG_HTML = (
  '<p><strong>市場結構觀察：</strong>本週指數在多空拉鋸中維持窄幅震盪，' +
  '權值股輪動明顯，資金持續往<em>算力題材</em>集中。</p>' +
  '<p>個股操作上，本週<strong>加碼 NVDA / AVGO / TSMC</strong>，' +
  '主要邏輯有三：<br/>1) 雲端資本支出上修並未鬆動；<br/>2) 推理需求延伸到邊緣裝置；' +
  '<br/>3) HBM 供不應求的能見度延伸至 2027 年。</p>' +
  '<p>風險方面請留意：地緣政治、匯率波動與 AI 泡沫論述再起，若指數量能收縮則採用金字塔式減碼。</p>' +
  '<p>本週亦教學了<strong>部位控管與加減碼節奏</strong>的計算方式，請務必參考本篇教學重點段落。</p>'
);

interface Case {
  key: 'A_short' | 'B_boundary' | 'C_long' | 'D_html';
  signalId: string;
  reasonSummary: string;
  /** 展開後 h1.textContent 應等於的純文字（去 HTML）。 */
  expectedPlain: string;
  shouldCollapse: boolean;
}

// 匹配 richHtmlToPlain：htmlToPlainText 直接去掉所有 tag（包含 <br>），再 collapse whitespace + trim
function toPlain(html: string): string {
  const noTag = html.replace(/<[^>]+>/g, '');
  return noTag.replace(/\s+/g, ' ').replace(/^[•·]\s*/g, '').trim();
}

const CASES: Case[] = [
  {
    key: 'A_short',
    signalId: 'sig-short',
    reasonSummary: SHORT_TITLE,
    expectedPlain: SHORT_TITLE,
    shouldCollapse: false,
  },
  {
    key: 'B_boundary',
    signalId: 'sig-boundary',
    reasonSummary: BOUNDARY_TITLE,
    expectedPlain: BOUNDARY_TITLE,
    shouldCollapse: BOUNDARY_TITLE.length > 80,
  },
  {
    key: 'C_long',
    signalId: 'sig-long',
    reasonSummary: LONG_TITLE,
    expectedPlain: LONG_TITLE,
    shouldCollapse: true,
  },
  {
    key: 'D_html',
    signalId: 'sig-html',
    reasonSummary: LONG_HTML,
    expectedPlain: toPlain(LONG_HTML),
    shouldCollapse: true,
  },
];

function buildSignal(c: Case) {
  return {
    id: c.signalId,
    instrument: 'TEST',
    action: 'buy',
    price_hint: 100,
    quantity: 1,
    quantity_unit: '張',
    reason_summary: c.reasonSummary,
    reason_detail: '整體摘要文字。',
    risk_notes: null,
    learning_points: '重點一\n重點二',
    published_at: new Date('2026-07-08T02:00:00Z').toISOString(),
    status: 'published',
    expert_id: EXPERT.id,
    experts: EXPERT,
  };
}

function baseRoutes(currentCase: Case) {
  const signal = buildSignal(currentCase);
  return {
    profiles: () => ({
      display_name: 'Admin Tester',
      expert_slug: null,
      avatar_url: null,
      line_user_id: null,
      is_tester: false,
    }),
    user_roles: () => [{ role: 'company_admin' }],
    experts: () => [EXPERT],
    member_subscriptions: () => [],
    expert_signals: ({ url }: { url: URL }) => {
      const query = url.search;
      // detail 單筆查詢 (`id=eq.<id>`)
      if (query.includes(`id=eq.${currentCase.signalId}`) && !query.includes('expert_id=eq.')) {
        return signal;
      }
      // 週內清單 (`expert_id=eq.expert-1`)
      if (query.includes(`expert_id=eq.${EXPERT.id}`)) {
        return [signal];
      }
      return [];
    },
    // 兜底：其他 RPC 一律回 null / [] 避免拉整頁 layout 資料時噴 500
    get_expert_detail_bundle: () => null,
    calculate_expert_performance: () => null,
    get_expert_capital_status: () => null,
    unread_notifications_count: () => 0,
    system_announcements: () => [],
  } as Record<string, (req: { method: string; url: URL; body: any }) => any>;
}

async function readH1Class(page: Page) {
  return page.evaluate(() => document.querySelector('h1')?.className || '');
}

async function readH1Text(page: Page) {
  return (await page.evaluate(() => document.querySelector('h1')?.textContent || '')).trim();
}

test.describe('/app/journal/:id 標題完整顯示 + 折疊', () => {
  for (const c of CASES) {
    test(`case ${c.key}: 長度=${c.expectedPlain.length} 應${c.shouldCollapse ? '顯示折疊按鈕' : '無折疊按鈕'}`, async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', (e) => pageErrors.push(e));

      await seedSession(page, { id: 'user-admin', email: 'admin@test.com' });
      await installRoutes(page, { rest: baseRoutes(c) });

      await page.goto(`/app/journal/${c.signalId}`);

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      await expect(page.getByText('找不到此週記')).toHaveCount(0);

      // 全文純文字應完整出現於 DOM，不含截斷 …，亦不含未 flatten 的 HTML 標籤
      const h1Text = await readH1Text(page);
      expect(h1Text).toBe(c.expectedPlain);
      expect(h1Text.endsWith('…')).toBe(false);
      expect(h1Text.includes('<')).toBe(false);

      const toggle = page.getByRole('button', { name: /^(顯示全部|收合)$/ });

      if (!c.shouldCollapse) {
        // 短標題：不出現折疊按鈕；h1 不帶 line-clamp-2
        await expect(toggle).toHaveCount(0);
        expect(await readH1Class(page)).not.toContain('line-clamp-2');
      } else {
        // 預設折疊
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveText('顯示全部');
        expect(await readH1Class(page)).toContain('line-clamp-2');

        // 點擊展開
        await toggle.click();
        await expect(toggle).toHaveText('收合');
        expect(await readH1Class(page)).not.toContain('line-clamp-2');
        // 展開後全文依然完整
        expect(await readH1Text(page)).toBe(c.expectedPlain);

        // 再點回折疊
        await toggle.click();
        await expect(toggle).toHaveText('顯示全部');
        expect(await readH1Class(page)).toContain('line-clamp-2');
      }

      expect(pageErrors, `pageerror: ${pageErrors.map(e => e.message).join(' | ')}`).toHaveLength(0);
    });
  }
});
