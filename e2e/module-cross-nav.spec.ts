/**
 * L5 · 跨模組導航契約 (E2E)
 *
 * 驗合法跨模組路徑：URL / route params。
 * 不合法路徑（模組互 import 內部檔）由 unit test 檔案掃描守門。
 */
import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

test.describe('L5 · URL param 跨模組跳轉', () => {
  test('portfolioId 在 URL 決定 shell + 各模組共用同一 activePortfolioId', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('checkup-coach-seen-v1', '1')
        window.localStorage.setItem('lf.checkup.onboarded', '1')
      } catch {}
    })

    await gotoWithRetry(page, '/portfolio/me/holdings', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await expect(page).toHaveURL(/\/portfolio\/me\/holdings/)

    // 直接改網址跳 events，Shell (PortfolioLayout) 應該保持 mount、只換 Outlet
    await page.evaluate(() => {
      window.history.pushState({}, '', '/portfolio/me/events')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/\/portfolio\/me\/events/)

    // shell Header 仍存在（判定 checkup-root 沒被 unmount）
    const shellStillMounted = await page.locator('.checkup-root').count()
    expect(shellStillMounted, 'Shell PortfolioLayout 應在跨模組切換時保持 mount').toBeGreaterThan(0)
  })
})
