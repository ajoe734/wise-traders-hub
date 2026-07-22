/**
 * E2E — overridePrice debounce / partial-fail / per-card loading
 *
 * 覆蓋範圍：
 *   1. 連續快速點擊「立即更新」→ debounce 只觸發最後一次 recompute（window.__demoSyncCount 只 +1）
 *   2. ?demoPartialFail=1 → 部分卡片顯示錯誤 strip、其他卡片仍成功 recompute；banner 顯示 partial 錯誤
 *   3. recompute 期間每張卡片顯示 [data-testid="holding-card-loading"] shimmer；結束後自動消失
 *   4. banner 內含 HTTP 狀態文字 + 「複製錯誤內容」按鈕，可寫入 clipboard
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2')
      window.localStorage.setItem('lf.checkup.onboarded', '1')
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done')
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1')
      ;(window as any).__demoSyncCount = 0
    } catch {}
  })
}

async function scrollThroughCards(page: Page) {
  for (const y of [400, 800, 1200, 1600]) {
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(150)
  }
}

test.describe('overridePrice debounce / partial-fail / per-card loading', () => {
  test('連續快速點擊 → debounce 只觸發最後一次 recompute', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    const btn = page.getByRole('button', { name: /立即更新|同步中|重試/ }).first()
    await expect(btn).toBeVisible({ timeout: 15000 })
    await btn.scrollIntoViewIfNeeded()

    // 快速點 5 次（間隔 30ms，遠短於 250ms debounce）
    for (let i = 0; i < 5; i++) {
      await btn.click({ force: true, noWaitAfter: true })
      await page.waitForTimeout(30)
    }

    // 等 debounce 觸發 (250ms) + demo delay 完成，counter 需 = 1
    await expect
      .poll(async () => await page.evaluate(() => (window as any).__demoSyncCount || 0), {
        timeout: 20000,
        intervals: [200, 500, 1000],
      })
      .toBe(1)

    // 再多等 1s 確保沒有第二次觸發
    await page.waitForTimeout(1000)
    const finalCount = await page.evaluate(() => (window as any).__demoSyncCount || 0)
    expect(finalCount, '5 次快速點擊只能觸發 1 次 recompute').toBe(1)
  })

  test('?demoPartialFail=1 → 部分卡片錯誤，其他成功；banner 顯示 partial + copy 按鈕', async ({
    page, context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1&demoPartialFail=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    await page.evaluate(() => { (window as any).__demoSyncCount = 0 })
    await page.getByRole('button', { name: /立即更新/ }).first().click()

    // 等 demo sync 執行完成（counter +1）
    await expect
      .poll(async () => await page.evaluate(() => (window as any).__demoSyncCount || 0), {
        timeout: 20000,
        intervals: [200, 500, 1000],
      })
      .toBe(1)

    // 至少一張卡片顯示 per-card 錯誤 strip
    const errCards = page.locator('[data-testid="holding-card-error"]')
    await expect(errCards.first()).toBeVisible({ timeout: 10000 })
    const errCount = await errCards.count()
    expect(errCount).toBeGreaterThanOrEqual(1)

    // 至少一張卡片仍有現價 chip（成功 recompute）
    const okChips = page.locator('.wb-card span[title*="現價"]')
    await expect(okChips.first()).toBeVisible()
    const okCount = await okChips.count()
    expect(okCount).toBeGreaterThanOrEqual(1)

    // Banner 出現，含 HTTP 狀態文字
    const banner = page.getByTestId('sync-error-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/部分個股 recompute 失敗/)
    await expect(page.getByTestId('sync-error-detail')).toContainText(/HTTP 207|嘗試/)

    // 複製錯誤內容按鈕
    const copyBtn = page.getByTestId('sync-error-copy')
    await expect(copyBtn).toBeVisible()
    await copyBtn.click()
    await expect(copyBtn).toContainText(/已複製/, { timeout: 3000 })
  })

  test('recompute 期間每張卡片顯示 loading shimmer；結束後消失', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    await page.getByRole('button', { name: /立即更新/ }).first().click()

    // debounce 250ms + demo delay 開始 → 應該能看到至少一個 loading overlay
    const loaders = page.locator('[data-testid="holding-card-loading"]')
    await expect(loaders.first()).toBeVisible({ timeout: 5000 })
    expect(await loaders.count()).toBeGreaterThanOrEqual(1)

    // 等 sync 完成 → loading 應全部消失
    await expect(async () => {
      const c = await loaders.count()
      expect(c).toBe(0)
    }).toPass({ timeout: 20000 })
  })
})
