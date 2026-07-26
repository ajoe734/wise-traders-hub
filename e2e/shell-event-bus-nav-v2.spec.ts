/**
 * L5 · Shell Event Bus v2 — closing:openStock / research:prefill / events:refresh
 * docs/architecture/shell-event-bus-tdd.md §8-2
 *
 * 走通契約：
 *   1. M1 → M2   closing:openStock   → /portfolio/:id/daily?stock=<code>[&date=YYYY-MM-DD]
 *   2. M2 → M5   research:prefill    → /portfolio/:id/research?stock=<code>&topic=<t>
 *   3. M3 → M5   research:prefill    → 同 URL 契約（source=events）
 *   4. M4 → M3   events:refresh      → EventsPage `data-events-refresh-tick` 遞增 ≥ 1
 *
 * 所有 assertion 都走 URL / DOM 觀測值，不觸網路。Shell 保持 mount → .checkup-root 常駐。
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

test.describe('L5 · Shell Event Bus v2', () => {
  test('closing:openStock → /portfolio/:id/daily?stock=<code>&date=<YYYY-MM-DD>', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('harness-title')).toBeVisible()

    await page.getByTestId('harness-stock-code').fill('2330')
    await page.getByTestId('harness-date').fill('2026-07-25')
    await page.getByTestId('harness-emit-closing-open-stock').click()

    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/daily\\?stock=2330&date=2026-07-25$`),
    )
    expect(await page.locator('.checkup-root').count()).toBeGreaterThan(0)
  })

  test('closing:openStock 沒有 date 時只帶 stock 參數', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('harness-stock-code').fill('AAPL')
    await page.getByTestId('harness-emit-closing-open-stock').click()

    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/daily\\?stock=AAPL$`),
    )
  })

  test('research:prefill（from M2 closing）→ /portfolio/:id/research?stock=&topic=', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('harness-stock-code').fill('2454')
    await page.getByTestId('harness-topic').fill('AI supply chain')
    await page.getByTestId('harness-emit-research-from-closing').click()

    // URLSearchParams encode: 空白 → '+', 因此 topic=AI+supply+chain
    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/research\\?stock=2454&topic=AI\\+supply\\+chain$`),
    )
  })

  test('research:prefill（from M3 events）→ 相同 URL 契約', async ({ page }) => {
    await gotoWithRetry(page, HARNESS_URL, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('harness-stock-code').fill('NVDA')
    await page.getByTestId('harness-emit-research-from-events').click()

    // 無 topic 只帶 stock
    await expect(page).toHaveURL(
      new RegExp(`/portfolio/${PORTFOLIO_ID}/research\\?stock=NVDA$`),
    )
  })

  test('events:refresh → EventsPage 的 refreshTick 遞增', async ({ page }) => {
    // 進入 EventsPage 並開啟 bus_test beacon
    await gotoWithRetry(page, `/portfolio/${PORTFOLIO_ID}/events?bus_test=1`, {
      waitUntil: 'domcontentloaded',
    })
    const tickHost = page.locator('[data-events-refresh-tick]')
    await expect(tickHost).toBeVisible()
    await expect(tickHost).toHaveAttribute('data-events-refresh-tick', '0')

    const beacon = page.getByTestId('events-bus-test-emit-refresh')
    await expect(beacon).toBeVisible()
    await beacon.click()
    await expect(tickHost).toHaveAttribute('data-events-refresh-tick', '1')

    // 二次 emit 必須繼續遞增（保序）
    await beacon.click()
    await expect(tickHost).toHaveAttribute('data-events-refresh-tick', '2')

    // Shell 沒被 unmount
    expect(await page.locator('.checkup-root').count()).toBeGreaterThan(0)
  })
})
