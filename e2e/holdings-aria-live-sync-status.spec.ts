/**
 * E2E — HoldingCard aria-live 螢幕閱讀器狀態
 *
 * 覆蓋範圍（audit 2026-06 a11y）：
 *   1. 每張 HoldingCard 都有 role="status" aria-live="polite" 的 SR-only 區塊
 *   2. 同步進行中 → aria-live 內容變成「正在更新 {name} {code} 現價…」
 *   3. 同步完成 → 內容更新為「{name} {code} 現價已更新」（priceUpdatedAt 設定後）
 *   4. 同步失敗 → holding-card-error role="alert" aria-live="assertive" 出現且含 SR-only 前綴
 *   5. 全頁 sync banner 也有 role="status" aria-live="polite"（idle → syncing → done 三態切換）
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

async function scrollThroughCards(page: Page) {
  for (const y of [400, 800, 1200, 1600]) {
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(150)
  }
}

async function findFirstCardWithStatus(page: Page): Promise<Locator> {
  const cards = page.locator('.wb-card').filter({
    has: page.locator('[role="status"][aria-live="polite"]'),
  })
  await expect(cards.first()).toBeVisible({ timeout: 20000 })
  return cards.first()
}

async function clickSync(page: Page) {
  const btn = page.getByRole('button', { name: /立即更新|同步中|重試/ }).first()
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  return btn
}

test.describe('HoldingCard aria-live 螢幕閱讀器狀態', () => {
  test('idle → syncing → done：每張卡的 aria-live 內容會更新', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    // 每張卡都必有一個 SR-only role="status" aria-live="polite"
    const statusRegions = page.locator(
      '.wb-card [role="status"][aria-live="polite"][aria-atomic="true"]',
    )
    const initialCount = await statusRegions.count()
    expect(initialCount).toBeGreaterThanOrEqual(4)

    // 第一次同步：先讓 priceUpdatedAt 有值
    await clickSync(page)
    await expect(page.locator('.wb-card [title*="現價"]').first())
      .toBeVisible({ timeout: 20000 })

    // 首張帶 status 的卡
    const card = await findFirstCardWithStatus(page)
    const status = card.locator('[role="status"][aria-live="polite"]').first()

    // idle 狀態：應包含「現價已更新」文字（priceUpdatedAt 已設定）
    await expect(status).toHaveText(/現價已更新/, { timeout: 20000 })

    // 觸發下一次同步 → 捕捉 syncing 過渡文字
    const syncingSeen = { value: false }
    const doneSeen = { value: false }

    const btn = page.getByRole('button', { name: /立即更新|同步中|重試/ }).first()
    // 監看該卡 status 的 textContent 變化
    const poller = (async () => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const t = ((await status.textContent()) || '').trim()
        if (/正在更新.*現價…/.test(t)) syncingSeen.value = true
        if (syncingSeen.value && /現價已更新/.test(t)) {
          doneSeen.value = true
          return
        }
        await page.waitForTimeout(50)
      }
    })()

    await btn.click()
    await poller

    expect(syncingSeen.value, 'aria-live 應在同步中變成「正在更新…」').toBeTruthy()
    expect(doneSeen.value, 'aria-live 應在完成後變成「現價已更新」').toBeTruthy()
  })

  test('全頁 sync banner 有 role="status" aria-live="polite"', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    // 觸發同步 → 全頁 banner 應出現 role="status"
    const btn = page.getByRole('button', { name: /立即更新|同步中|重試/ }).first()
    await btn.scrollIntoViewIfNeeded()

    let sawSyncing = false
    const observer = (async () => {
      const deadline = Date.now() + 12000
      while (Date.now() < deadline) {
        const regions = page.locator('[role="status"][aria-live="polite"]')
        const n = await regions.count()
        for (let i = 0; i < n; i++) {
          const t = ((await regions.nth(i).textContent()) || '').trim()
          if (/正在同步持倉現價|同步完成/.test(t)) {
            sawSyncing = true
            return
          }
        }
        await page.waitForTimeout(80)
      }
    })()

    await btn.click()
    await observer
    expect(sawSyncing, '全頁 banner 應以 role="status" aria-live="polite" 播報同步進度').toBeTruthy()
  })

  test('同步失敗：holding-card-error 帶 role="alert" aria-live="assertive" + SR-only 前綴', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1&debugPrice=1&demoPartialFail=1')
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })
    await scrollThroughCards(page)

    await clickSync(page)

    const errStrip = page.locator('[data-testid="holding-card-error"]').first()
    await expect(errStrip).toBeVisible({ timeout: 20000 })
    await expect(errStrip).toHaveAttribute('role', 'alert')
    await expect(errStrip).toHaveAttribute('aria-live', 'assertive')
    await expect(errStrip).toHaveAttribute('aria-atomic', 'true')
    // SR-only 前綴：「{cardLabel} 更新失敗：」
    await expect(errStrip.locator('.sr-only')).toContainText(/更新失敗/)
  })
})
