/**
 * E2E — overridePrice 情境覆蓋（audit 2026-06 H4/H5 延伸）
 *
 * 場景：
 *   1. market-closed（quote 帶 yesterday）→ 換價後 TODAY 重算、yesterday 不變
 *   2. market-open（quote 無 yesterday）→ normalize 沿用先前收盤作為 yesterday；
 *      TODAY 仍重算、yesterday 不變
 *   3. 一次「立即更新」同步刷新多張卡片 → 每張 TODAY 都更新、yesterday 全數保留
 *   4. 同步 API 失敗 → 顯示持久錯誤 banner + 「重試」按鈕；點重試後可恢復
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2')
      window.localStorage.setItem('lf.checkup.onboarded', '1')
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done')
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1')
    } catch {}
  })
}

function parseTitle(title: string | null) {
  if (!title) return { price: null as number | null, yesterday: null as number | null }
  const pm = title.match(/現價\s*([\d.]+)/)
  const ym = title.match(/昨收\s*([\d.]+)/)
  return {
    price: pm ? Number(pm[1]) : null,
    yesterday: ym ? Number(ym[1]) : null,
  }
}

async function readCard(card: Locator) {
  const chip = card.locator('[title*="現價"]').first()
  const title = await chip.getAttribute('title')
  const { price, yesterday } = parseTitle(title)
  const todayText = (await card.locator('.wb-bottom-val').first().textContent())?.trim() || ''
  return { title, price, yesterday, todayText }
}

async function scrollThroughCards(page: Page) {
  for (const y of [400, 800, 1200, 1600]) {
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(200)
  }
}

async function clickSync(page: Page) {
  const btn = page.getByRole('button', { name: /立即更新|同步中|重試/ }).first()
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  // 等回到「立即更新」（成功）或「重試」（失敗 → 錯誤 banner 出現）
  await expect(async () => {
    const t = (await btn.textContent()) || ''
    expect(/立即更新|重試/.test(t)).toBeTruthy()
  }).toPass({ timeout: 15000 })
}

async function snapshotCards(page: Page, limit = 5) {
  const cards = page.locator('.wb-card').filter({
    has: page.locator('[title*="現價"]'),
  })
  const n = Math.min(await cards.count(), limit)
  const snaps: Array<{ idx: number; price: number; yesterday: number; today: string }> = []
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i)
    await c.scrollIntoViewIfNeeded()
    const s = await readCard(c)
    if (s.price != null && s.yesterday != null) {
      snaps.push({ idx: i, price: s.price, yesterday: s.yesterday, today: s.todayText })
    }
  }
  return { cards, snaps }
}

test.describe('overridePrice 情境覆蓋', () => {
  test('market-closed：換價後 TODAY 重算，yesterday 不變', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)
    await clickSync(page)
    await expect(page.locator('.wb-card [title*="現價"]').first())
      .toBeVisible({ timeout: 20000 })

    const before = await snapshotCards(page)
    expect(before.snaps.length).toBeGreaterThanOrEqual(2)

    await clickSync(page)
    let changed = 0
    for (const b of before.snaps) {
      const c = before.cards.nth(b.idx)
      await c.scrollIntoViewIfNeeded()
      const a = await readCard(c)
      expect(a.yesterday, `card #${b.idx} 昨收必須保留`).toBe(b.yesterday)
      expect(a.todayText, `card #${b.idx} TODAY 不得為 stale/空`).not.toBe('—')
      if (a.price !== b.price) changed += 1
    }
    expect(changed).toBeGreaterThanOrEqual(Math.ceil(before.snaps.length / 2))
  })

  test('market-open：quote 無 yesterday → normalize 沿用先前收盤，TODAY 仍重算', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1&demoMarketOpen=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)
    await clickSync(page)
    const before = await snapshotCards(page)
    expect(before.snaps.length).toBeGreaterThanOrEqual(2)

    await clickSync(page)
    for (const b of before.snaps) {
      const c = before.cards.nth(b.idx)
      await c.scrollIntoViewIfNeeded()
      const a = await readCard(c)
      // 盤中：quote 無 yesterday，但 normalize 應沿用「上一輪收盤」作為 yesterday（永不遺失）
      expect(a.yesterday, `card #${b.idx} 盤中換價後 yesterday 仍需保留`).toBe(b.yesterday)
      expect(a.todayText, `card #${b.idx} TODAY 不得為 stale/空`).not.toBe('—')
    }
  })

  test('一次同步 → 多張卡片同時更新，yesterday 全數保留', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)
    await clickSync(page)
    const before = await snapshotCards(page, 8)
    expect(before.snaps.length).toBeGreaterThanOrEqual(4)

    // 單一次「立即更新」 → 所有卡片同時被 setHoldings 覆寫
    await clickSync(page)
    let changed = 0
    for (const b of before.snaps) {
      const c = before.cards.nth(b.idx)
      await c.scrollIntoViewIfNeeded()
      const a = await readCard(c)
      expect(a.yesterday, `card #${b.idx} yesterday 需保留`).toBe(b.yesterday)
      expect(a.todayText, `card #${b.idx} TODAY 不得空`).not.toBe('—')
      if (a.price !== b.price) changed += 1
    }
    // 一次同步 → 大多數卡片應同時變動
    expect(changed).toBeGreaterThanOrEqual(Math.ceil(before.snaps.length * 0.6))
  })

  test('同步失敗：顯示錯誤 banner + 重試按鈕，點重試可恢復', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1&demoSyncError=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    // 第一次同步 → 應失敗（?demoSyncError=1 觸發模擬錯誤）
    await page.getByRole('button', { name: /立即更新/ }).first().click()

    const banner = page.getByTestId('sync-error-banner')
    await expect(banner).toBeVisible({ timeout: 20000 })
    await expect(banner).toContainText(/報價同步失敗/)

    const retry = page.getByTestId('sync-error-retry')
    await expect(retry).toBeVisible()

    // Loading 狀態：按鈕在 idle 時就存在（disabled=false）→ 驗證後點擊即開始重試
    await expect(retry).toBeEnabled()
    await retry.click()

    // ?demoSyncError=1 消耗後應恢復 → banner 消失、卡片開始有現價 chip
    await expect(banner).toBeHidden({ timeout: 15000 })
    await expect(page.locator('.wb-card [title*="現價"]').first())
      .toBeVisible({ timeout: 20000 })
  })
})
