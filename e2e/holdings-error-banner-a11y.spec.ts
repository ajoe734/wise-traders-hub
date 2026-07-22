/**
 * E2E — Sync error banner 可存取性 + HoldingCard aria-busy
 *
 * 覆蓋範圍：
 *   1. HoldingCard 同步中 aria-busy="true" + aria-describedby → 狀態 span，完成後自動清除
 *   2. Error banner 具備可辨識標題（h4）+ 訊息/明細分區 + role="alertdialog" + aria-labelledby
 *   3. 「複製錯誤內容」按鈕可用鍵盤 Tab + Enter 觸發，複製成功會透過 aria-live 播報
 *   4. 連續 3 次失敗 → exhausted 提示區出現，「手動重新整理頁面」與「重試」按鈕可聚焦可操作，
 *      且 exhausted 訊息透過 role="alertdialog" aria-live="assertive" 立即播報
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
    } catch {}
  })
}

async function scrollThroughCards(page: Page) {
  for (const y of [400, 800, 1200, 1600]) {
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(120)
  }
}

test.describe('HoldingCard aria-busy + Error banner a11y', () => {
  test('同步中 aria-busy=true → 完成自動清除', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    const btn = page.getByRole('button', { name: /立即更新|同步中|重試/ }).first()
    await btn.scrollIntoViewIfNeeded()

    // 觀察：任一 wb-card 於同步中要出現 aria-busy="true"
    let sawBusy = false
    const poll = (async () => {
      const deadline = Date.now() + 12000
      while (Date.now() < deadline) {
        const n = await page.locator('.wb-card[aria-busy="true"]').count()
        if (n > 0) { sawBusy = true; return }
        await page.waitForTimeout(60)
      }
    })()
    await btn.click()
    await poll
    expect(sawBusy, '同步中應至少一張卡出現 aria-busy="true"').toBeTruthy()

    // 完成後自動清除
    await expect
      .poll(async () => page.locator('.wb-card[aria-busy="true"]').count(), { timeout: 15000 })
      .toBe(0)

    // 完成後 aria-describedby 也不應繼續指向 loading/error id
    const stillDescribed = await page.locator('.wb-card[aria-describedby*="holding-card-error-"]').count()
    expect(stillDescribed).toBe(0)
  })

  test('Error banner 結構 + 複製鍵盤操作 + aria-live 播報成功', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1&demoSyncError=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    // 觸發失敗
    await page.getByRole('button', { name: /立即更新|同步中|重試/ }).first().click()

    const banner = page.locator('[data-testid="sync-error-banner"]')
    await expect(banner).toBeVisible({ timeout: 15000 })
    await expect(banner).toHaveAttribute('role', 'alertdialog')
    await expect(banner).toHaveAttribute('aria-live', 'assertive')
    await expect(banner).toHaveAttribute('aria-labelledby', 'sync-error-banner-title')
    await expect(banner).toHaveAttribute('aria-describedby', /sync-error-banner-message.*sync-error-banner-detail/)

    // 標題／訊息／明細三個分區
    const title = page.locator('[data-testid="sync-error-banner-title"]')
    await expect(title).toBeVisible()
    await expect(title).toHaveText(/失敗/)
    await expect(page.locator('[data-testid="sync-error-message"]')).toContainText(/報價同步失敗/)
    await expect(page.locator('[data-testid="sync-error-detail"]')).toContainText(/網路|HTTP|demoSyncError/)

    // 鍵盤操作「複製錯誤內容」：聚焦後按 Enter
    const copyBtn = page.locator('[data-testid="sync-error-copy"]')
    await copyBtn.focus()
    await expect(copyBtn).toBeFocused()
    await page.keyboard.press('Enter')

    // 按鈕文字更新 + aria-live 播報成功
    await expect(copyBtn).toHaveText(/已複製/, { timeout: 3000 })
    const copyStatus = page.locator('[data-testid="sync-copy-status"]')
    await expect(copyStatus).toHaveAttribute('role', 'status')
    await expect(copyStatus).toHaveAttribute('aria-live', 'polite')
    await expect(copyStatus).toHaveText(/錯誤內容已複製到剪貼簿/, { timeout: 3000 })

    // 剪貼簿內容確實含錯誤訊息
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
    expect(clip).toMatch(/freecheckup sync error/)
    expect(clip).toMatch(/message:/)
  })

  test('連續 3 次失敗 → exhausted 提示可讀 + 手動重新整理按鈕可聚焦操作', async ({ page }) => {
    await primeDemo(page)
    // sticky flag：每次重試都會失敗，直到 exhausted (>=3)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1&demoSyncError=sticky')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    // 第 1 次：由主按鈕觸發
    await page.getByRole('button', { name: /立即更新|同步中|重試/ }).first().click()
    await expect(page.locator('[data-testid="sync-error-banner"]')).toBeVisible({ timeout: 15000 })

    // 第 2、3 次：點 banner 的「重試」按鈕；輪詢直到 exhausted 為止
    const retry = page.locator('[data-testid="sync-error-retry"]')
    const title = page.locator('[data-testid="sync-error-banner-title"]')
    for (let i = 0; i < 6; i++) {
      const t = ((await title.textContent()) || '').trim()
      if (/連續失敗/.test(t)) break
      await expect(retry).toBeEnabled({ timeout: 15000 })
      await retry.click()
      // 等這一輪 debounce+syncing 結束（按鈕文字回到「重試」）
      await expect(retry).toHaveText(/^重試$/, { timeout: 15000 })
      await page.waitForTimeout(200)
    }


    // exhausted 提示區出現
    const hint = page.locator('[data-testid="sync-error-exhausted-hint"]')
    await expect(hint).toBeVisible({ timeout: 10000 })
    await expect(hint).toHaveAttribute('role', 'group')
    await expect(hint).toHaveAttribute('aria-label', /建議動作/)

    // 明細中含「建議重新整理或稍後再試」
    await expect(page.locator('[data-testid="sync-error-detail"]'))
      .toContainText(/建議重新整理或稍後再試/)

    // banner 標題切換為「連續失敗」
    await expect(page.locator('[data-testid="sync-error-banner-title"]'))
      .toHaveText(/連續失敗/)

    // banner 仍是 role="alertdialog" aria-live="assertive"（螢幕閱讀器立即播報）
    const banner = page.locator('[data-testid="sync-error-banner"]')
    await expect(banner).toHaveAttribute('role', 'alertdialog')
    await expect(banner).toHaveAttribute('aria-live', 'assertive')

    // 「手動重新整理頁面」按鈕可聚焦
    const refreshBtn = page.locator('[data-testid="sync-error-refresh"]')
    await refreshBtn.focus()
    await expect(refreshBtn).toBeFocused()
    await expect(refreshBtn).toBeEnabled()

    // 「重試」按鈕仍可聚焦、可操作（非 disabled）
    await retry.focus()
    await expect(retry).toBeFocused()
    await expect(retry).toBeEnabled()
  })
})
