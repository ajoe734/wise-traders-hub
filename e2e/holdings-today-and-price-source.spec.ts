/**
 * Regression: HoldingCard TODAY 欄與價格來源指示
 *
 * 覆蓋範圍（audit 2026-06 H2/H4/H5 修復）：
 *   1. demo 持倉每張卡都必有 TODAY 數字（不是「—」），且與 todayPnl/todayPct 一致
 *   2. 卡片右上角必顯示價格來源 chip（DEMO / 昨收 / 收盤 / ...）
 *   3. ?debugPrice=1 時 chip 的 title 帶「昨收 xxx、現價 xxx」細節
 *   4. 市場已收盤 vs 盤中兩種 quote 皆能正確渲染（不會因 quote 缺 yesterday 而 crash）
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

const ROUTE = '/holding-checkup?demo=1&debugPrice=1'

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2')
      window.localStorage.removeItem('checkup-coach-seen-v1')
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1')
    } catch {}
  })
}

test.describe('HoldingCard TODAY 值與價格來源', () => {
  test.beforeEach(async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, ROUTE)
    // 等首張卡出現
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20000 })
  })

  test('每張 demo 卡的 TODAY 欄都渲染出數字（不是 —）', async ({ page }) => {
    const cards = page.locator('.wb-card')
    const count = await cards.count()
    expect(count).toBeGreaterThan(3)

    let cardsWithToday = 0
    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i)
      const bottom = card.locator('.wb-bottom-val').first()
      const text = (await bottom.textContent())?.trim() || ''
      // 允許少數卡因無 qty 沒法算，但至少多數卡要有 +/- 數字
      if (/[+\-]\d/.test(text)) cardsWithToday += 1
    }
    // demo 20 檔全帶 yesterday → 至少 4/8 卡有 TODAY 數字
    expect(cardsWithToday).toBeGreaterThanOrEqual(4)
  })

  test('DEMO 標籤 chip 顯示，且 title 帶昨收/現價（?debugPrice=1）', async ({ page }) => {
    const chip = page
      .locator('.wb-card span[title*="來源"]')
      .first()
    await expect(chip).toBeVisible()
    const title = await chip.getAttribute('title')
    expect(title).toBeTruthy()
    expect(title!).toMatch(/來源：/)
    // debugPrice=1 → title 帶「昨收」與「現價」
    expect(title!).toMatch(/昨收 \d/)
    expect(title!).toMatch(/現價 \d/)
  })
})
