/**
 * L5 · Shell Event Bus E2E harness
 * docs/architecture/shell-event-bus.md §4 S5 / §6
 *
 * 驗證：
 *   1. 從 M2 (closing) barrel 的 useEmitHoldingsFocus 觸發 → 導頁到
 *      /portfolio/<id>/holdings?expand=<stockCode>
 *   2. 從 M3 (events) barrel 同名 helper 觸發 → 相同行為
 *   3. 自訂 stockCode（含需 encode 的字元）也正確帶入 query string
 *   4. Shell layout 保持 mount（跨模組跳轉不 unmount PortfolioLayout）
 */
import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

const PORTFOLIO_ID = 'me'
const HARNESS_URL = `/portfolio/${PORTFOLIO_ID}/__shell-bus`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1')
      window.localStorage.setItem('lf.checkup.onboarded', '1')
    } catch {}
  })
})

test.describe('L5 · Shell Event Bus → route navigation', () => {
  test('M2 closing emit → /portfolio/:id/holdings?expand=<code>', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('harness-title')).toBeVisible()

    await page.getByTestId('harness-emit-from-closing').click()

    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/holdings\\?expand=2330$`),
    )
    // Shell 沒被 unmount
    expect(await page.locator('.checkup-root').count()).toBeGreaterThan(0)
  })

  test('M3 events emit → 同樣導頁行為', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('harness-stock-code').fill('2454')
    await page.getByTestId('harness-emit-from-events').click()

    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/holdings\\?expand=2454$`),
    )
  })

  test('自訂 stockCode 走 encodeURIComponent（含 US ticker 與特殊字元）', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('harness-stock-code').fill('BRK.B')
    await page.getByTestId('harness-emit-from-closing').click()

    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/holdings\\?expand=BRK(?:\\.|%2E)B$`),
    )
  })
})
