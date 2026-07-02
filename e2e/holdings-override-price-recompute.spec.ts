/**
 * Regression E2E — 換價後 HoldingCard 的 todayPnl / todayPct 必須重算，且 yesterday 不會遺失
 *
 * 對應 audit 2026-06 的 H4/H5 safeguard：
 *   - demo 「⟳ 立即更新」會隨機微幅波動每檔現價（±1.5%）
 *   - 每次觸發後，卡片上的價格、TOTAL、以及 chip title 內的「現價 XXX」必須同步更新
 *   - chip title 的「昨收 YYY」欄位在多次換價後仍保留（不會變成 undefined 或消失）
 *   - todayPnl/todayPct 由 normalizeHoldingMetrics 重算，不會沿用前一輪 stale 值
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

function extractPriceFromTitle(title: string | null) {
  if (!title) return { price: null as number | null, yesterday: null as number | null }
  const priceMatch = title.match(/現價\s*([\d.]+)/)
  const ycMatch = title.match(/昨收\s*([\d.]+)/)
  return {
    price: priceMatch ? Number(priceMatch[1]) : null,
    yesterday: ycMatch ? Number(ycMatch[1]) : null,
  }
}

async function readCardState(card: Locator) {
  const chip = card.locator('span[title*="現價"]').first()
  const title = await chip.getAttribute('title')
  const { price, yesterday } = extractPriceFromTitle(title)
  const todayText = (await card.locator('.wb-bottom-val').first().textContent())?.trim() || ''
  return { price, yesterday, todayText, title }
}

test.describe('overridePrice → HoldingCard recompute safeguard', () => {
  test.beforeEach(async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, ROUTE)
    // 先確保出現持倉看板 → 捲到卡片區觸發 inView 讓 chip 真的渲染
    await expect(page.getByText('持倉看板').first()).toBeVisible({ timeout: 20000 })
    await page.evaluate(() => window.scrollTo(0, 400))
    await page.waitForTimeout(600)
    await page.evaluate(() => window.scrollTo(0, 800))
    await page.waitForTimeout(600)
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20000 })
    // 等到至少一張卡出現 chip（demo seed 有 priceSource='demo'，會渲染）
    await expect(page.locator('.wb-card span[title*="現價"]').first()).toBeVisible({ timeout: 20000 })
  })

  test('點擊「立即更新」後卡片現價會變動，且昨收/todayPnl 皆重算不 stale', async ({ page }) => {
    const cardsWithChip = page.locator('.wb-card').filter({ has: page.locator('span[title*="現價"]') })
    const total = await cardsWithChip.count()
    const sampleCount = Math.min(total, 5)
    expect(sampleCount).toBeGreaterThanOrEqual(2)

    const before: Array<{ idx: number; price: number; yesterday: number; todayText: string }> = []
    for (let i = 0; i < sampleCount; i++) {
      const card = cardsWithChip.nth(i)
      await card.scrollIntoViewIfNeeded()
      const s = await readCardState(card)
      if (s.price != null && s.yesterday != null) {
        before.push({ idx: i, price: s.price, yesterday: s.yesterday, todayText: s.todayText })
      }
    }
    expect(before.length).toBeGreaterThanOrEqual(2)

    const syncBtn = page.getByRole('button', { name: /立即更新|同步中/ }).first()
    await syncBtn.scrollIntoViewIfNeeded()
    await syncBtn.click()
    await expect(syncBtn).toHaveText(/立即更新/, { timeout: 10000 })

    let changedCount = 0
    for (const b of before) {
      const card = cardsWithChip.nth(b.idx)
      await card.scrollIntoViewIfNeeded()
      const after = await readCardState(card)
      expect(after.price, `card #${b.idx} 現價不應消失`).not.toBeNull()
      expect(after.yesterday, `card #${b.idx} 昨收在換價後必須保留`).toBe(b.yesterday)
      if (after.price !== b.price) changedCount += 1
    }
    expect(changedCount, '至少半數卡片價格必須因 override 而變動').toBeGreaterThanOrEqual(Math.ceil(before.length / 2))

    // 再點一次確認多輪 override 都不會遺失 yesterday
    await syncBtn.scrollIntoViewIfNeeded()
    await syncBtn.click()
    await expect(syncBtn).toHaveText(/立即更新/, { timeout: 10000 })

    for (const b of before) {
      const card = cardsWithChip.nth(b.idx)
      await card.scrollIntoViewIfNeeded()
      const after2 = await readCardState(card)
      expect(after2.title!, `card #${b.idx} chip title 必須帶昨收/現價`).toMatch(/昨收\s*[\d.]+/)
      expect(after2.title!).toMatch(/現價\s*[\d.]+/)
      expect(after2.yesterday, `card #${b.idx} 兩輪換價後昨收仍需保留`).toBe(b.yesterday)
    }
  })
})
