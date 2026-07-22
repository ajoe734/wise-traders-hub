/**
 * Regression E2E — H4/H5 safeguard
 * 換價（overridePrice → 走 normalizeHoldingMetrics）後：
 *   - 卡片現價會變動
 *   - 昨收（yesterday）跨多輪 override 永遠不會遺失
 *   - todayPnl / todayPct 由 normalize 重算，不會沿用前一輪 stale 值
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

const ROUTE = '/holding-checkup?demo=1&debugPrice=1'

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2')
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

async function clickSync(page: Page) {
  const btn = page.getByRole('button', { name: /立即更新|同步中/ }).first()
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await expect(btn).toHaveText(/立即更新/, { timeout: 10000 })
}

test.describe('overridePrice → HoldingCard recompute safeguard', () => {
  test('多輪 override 後 yesterday 不遺失、todayPnl/todayPct 重算', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, ROUTE)
    await expect(page.locator('[data-testid="holdings-hero"]').first()).toBeVisible({ timeout: 20000 })

    // 捲到卡片區觸發 IntersectionObserver → 讓 inner span 真的 mount
    for (const y of [400, 800, 1200, 1600]) {
      await page.evaluate((v) => window.scrollTo(0, v), y)
      await page.waitForTimeout(300)
    }
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20000 })

    // 先點一次同步：demo 分支會把 priceSource 設為 'live'，chip 一定會渲染
    await clickSync(page)
    await expect(page.locator('.wb-card [title*="現價"]').first())
      .toBeVisible({ timeout: 20000 })

    const cardsWithChip = page.locator('.wb-card').filter({
      has: page.locator('[title*="現價"]'),
    })
    const sampleN = Math.min(await cardsWithChip.count(), 5)
    expect(sampleN).toBeGreaterThanOrEqual(2)

    // 快照 BEFORE
    const before: Array<{ idx: number; price: number; yesterday: number; today: string }> = []
    for (let i = 0; i < sampleN; i++) {
      const c = cardsWithChip.nth(i)
      await c.scrollIntoViewIfNeeded()
      const s = await readCard(c)
      if (s.price != null && s.yesterday != null) {
        before.push({ idx: i, price: s.price, yesterday: s.yesterday, today: s.todayText })
      }
    }
    expect(before.length).toBeGreaterThanOrEqual(2)

    // 第 2 輪 override
    await clickSync(page)

    let changed = 0
    for (const b of before) {
      const c = cardsWithChip.nth(b.idx)
      await c.scrollIntoViewIfNeeded()
      const after = await readCard(c)
      expect(after.price, `card #${b.idx} 現價不應消失`).not.toBeNull()
      expect(after.yesterday, `card #${b.idx} 昨收在換價後必須完整保留`).toBe(b.yesterday)
      expect(after.title!, `card #${b.idx} chip title 必須含現價/昨收`).toMatch(/現價\s*[\d.]+/)
      expect(after.title!).toMatch(/昨收\s*[\d.]+/)
      if (after.price !== b.price) changed += 1
      // TODAY 欄位不應該回退為 "—"（demo 已 seed yesterday → 一律應有數字）
      expect(after.today, `card #${b.idx} TODAY 不應為 stale/空值`).not.toBe('—')
    }
    // 隨機 ±1.5% → 至少半數卡片會變動
    expect(changed, '至少半數卡片現價要因 override 而更新')
      .toBeGreaterThanOrEqual(Math.ceil(before.length / 2))

    // 第 3 輪：確認多輪後 yesterday 依然保留
    await clickSync(page)
    for (const b of before) {
      const c = cardsWithChip.nth(b.idx)
      await c.scrollIntoViewIfNeeded()
      const s = await readCard(c)
      expect(s.yesterday, `card #${b.idx} 三輪 override 後昨收仍需保留`).toBe(b.yesterday)
    }
  })
})
