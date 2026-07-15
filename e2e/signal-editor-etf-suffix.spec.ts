import { test, expect, type Route } from '@playwright/test';

/**
 * 週記 / 訊號編輯器：英文字尾 ETF 顯示回歸
 *
 * 覆蓋範圍：
 *   - 純數字（2330 台積電） — baseline，不應被誤解讀為 ETF
 *   - 4 位數字 + 英文字尾（00631L 元大台灣50正2）
 *   - 5 位數字 + 英文字尾（00878B 國泰永續高股息）
 *   - 6 位數字 + 英文字尾（012345Z 邊界虛擬 ETF）
 *   - 小寫輸入自動 uppercase（00631l → 00631L）
 *   - resolver 找不到名稱時 fallback 只顯示代號、不炸畫面
 *
 * 攔截 supabase `stock_names` REST 與 `stock-name-lookup` edge function，
 * 讓測試完全 hermetic、不依賴後端資料狀態。
 */

type NameMap = Record<string, string>;

async function installMock(page: any, names: NameMap) {
  // stock_names REST — 一律回空陣列，強迫走 edge function batch。
  await page.route(/\/rest\/v1\/stock_names.*/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
  // stock-name-lookup edge function — 回傳測試用命名映射。
  await page.route(/\/functions\/v1\/stock-name-lookup/, async (route: Route) => {
    let requested: string[] = [];
    try {
      const body = route.request().postDataJSON();
      requested = Array.isArray(body?.symbols) ? body.symbols : [];
    } catch {
      /* noop */
    }
    const out: NameMap = {};
    for (const s of requested) if (names[s]) out[s] = names[s];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(out),
    });
  });
}

async function typeAndResolve(
  page: any,
  code: string,
): Promise<void> {
  const input = page.getByTestId('editor-code-input');
  await input.click();
  await input.fill('');
  await input.type(code, { delay: 20 });
  // 等待 debounce (200ms) + batch window (2s) 之後 resolver flush
  await expect(page.getByTestId('editor-resolving')).toHaveText('idle', { timeout: 8_000 });
}

const NAMES: NameMap = {
  '2330': '台積電',
  '00631L': '元大台灣50正2',
  '00878B': '國泰永續高股息',
  '012345Z': '虛構ETF邊界',
};

test.describe('Signal editor — ETF 英文字尾顯示 parity', () => {
  test.beforeEach(async ({ page }) => {
    await installMock(page, NAMES);
    await page.goto('/e2e/signal-editor-harness?ac=tw_stock', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('editor-code-input')).toBeVisible();
  });

  for (const code of ['2330', '00631L', '00878B', '012345Z']) {
    test(`${code} — 列表與內容區顯示相同代號+名稱`, async ({ page }) => {
      await typeAndResolve(page, code);
      const expected = `${code} ${NAMES[code]}`;
      await expect(page.getByTestId('editor-list-instrument')).toHaveText(expected);
      await expect(page.getByTestId('editor-content-code')).toHaveText(code);
      await expect(page.getByTestId('editor-content-name')).toHaveText(NAMES[code]);
    });
  }

  test('小寫輸入 → 自動 uppercase 且成功解析 ETF 名稱', async ({ page }) => {
    await typeAndResolve(page, '00631l');
    await expect(page.getByTestId('editor-code-input')).toHaveValue('00631L');
    await expect(page.getByTestId('editor-list-instrument')).toHaveText('00631L 元大台灣50正2');
    await expect(page.getByTestId('editor-content-code')).toHaveText('00631L');
    await expect(page.getByTestId('editor-content-name')).toHaveText('元大台灣50正2');
  });

  test('未命名代號 → 只顯示代號、無例外', async ({ page }) => {
    await typeAndResolve(page, '99999X');
    await expect(page.getByTestId('editor-list-instrument')).toHaveText('99999X');
    await expect(page.getByTestId('editor-content-code')).toHaveText('99999X');
    await expect(page.getByTestId('editor-content-name')).toHaveCount(0);
  });

  test('列表與內容區文字必須完全相同（跨 ETF 迭代）', async ({ page }) => {
    for (const code of ['2330', '00631L', '00878B']) {
      await typeAndResolve(page, code);
      const list = await page.getByTestId('editor-list-instrument').textContent();
      const contentCode = await page.getByTestId('editor-content-code').textContent();
      const contentName = await page.getByTestId('editor-content-name').textContent();
      expect(list?.trim()).toBe(`${contentCode?.trim()} ${contentName?.trim()}`);
    }
  });
});
