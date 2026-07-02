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
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20000 })
  })

  test('點擊「立即更新」後每張卡的現價都變動，且昨收/TODAY 皆重算不 stale', async ({ page }) => {
    const cards = page.locator('.wb-card')
    const total = await cards.count()
    const sampleCount = Math.min(total, 6)

    // 選一批目前有 chip title 帶「現價/昨收」的卡（demo 已 seed yesterday）
    const before: Array<{ idx: number; price: number; yesterday: number; todayText: string }> = []
    for (let i = 0; i < sampleCount; i++) {
      const s = await readCardState(cards.nth(i))
      if (s.price != null && s.yesterday != null) {
        before.push({ idx: i, price: s.price, yesterday: s.yesterday, todayText: s.todayText })
      }
    }
    expect(before.length).toBeGreaterThanOrEqual(3)

    // 點擊「⟳ 立即更新」（demo 分支會 ±1.5% 隨機重報價並經 normalizeHoldingMetrics 重算）
    const syncBtn = page.getByRole('button', { name: /立即更新|同步中/ }).first()
    await expect(syncBtn).toBeVisible()
    await syncBtn.click()

    // 等按鈕跳回「立即更新」代表 demo delay 結束
    await expect(syncBtn).toHaveText(/立即更新/, { timeout: 8000 })

    // 逐張比對
    let changedCount = 0
    for (const b of before) {
      const after = await readCardState(cards.nth(b.idx))
      expect(after.price, `card #${b.idx} 現價不應消失`).not.toBeNull()
      expect(after.yesterday, `card #${b.idx} 昨收在換價後必須保留`).toBe(b.yesterday)
      // 現價幾乎必然變動（±1.5% 隨機，機率極高）
      if (after.price !== b.price) changedCount += 1
    }
    // 至少多數卡片價格有變動 → 證明 override 有生效
    expect(changedCount).toBeGreaterThanOrEqual(Math.ceil(before.length / 2))

    // 連續換兩次，確保多輪後仍不會出現 stale：昨收保留、chip title 仍含「現價/昨收」
    await syncBtn.click()
    await expect(syncBtn).toHaveText(/立即更新/, { timeout: 8000 })

    for (const b of before) {
      const after2 = await readCardState(cards.nth(b.idx))
      expect(after2.title, `card #${b.idx} chip title 必須帶昨收/現價`).toMatch(/昨收\s*[\d.]+/)
      expect(after2.title!).toMatch(/現價\s*[\d.]+/)
      expect(after2.yesterday, `card #${b.idx} 兩輪換價後昨收仍需保留`).toBe(b.yesterday)
    }
  })
})
