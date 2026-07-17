/**
 * E2E 回歸 — 持倉看板：目標價輸入 0
 *
 * 保護 `HoldingsTable` 的 target-price 邏輯不再退化為
 * `e.target.value ? Number(...) : null`（會把 0 當成 falsy 吃掉）
 * 以及 `holding.targetPrice ?? ''`（`||` 會把 0 顯示成空白）。
 *
 * 驗證：
 *   1) 使用者於「目標價」輸入 0 → input 立即顯示 "0"（不是空白）
 *   2) 「距目標」提示應出現，且為 -100.0%
 *   3) 折疊 → 重新展開後 input 仍顯示 "0"（狀態被儲存，不是 null / 空白）
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2')
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1')
    } catch {}
  })
}

test.describe('持倉看板 · 目標價 = 0 回歸', () => {
  test('輸入 0：即時顯示 "0"、距目標 -100.0%、折疊再展開後仍保留 0', async ({ page }) => {
    await primeDemo(page)
    await gotoWithRetry(page, '/holding-checkup?demo=1')
    await expect(page.getByRole('region', { name: '持倉概覽' })).toBeVisible({ timeout: 20000 })

    // 找第一張持股卡的「展開」按鈕
    const expandBtn = page.getByRole('button', { name: '展開' }).first()
    await expect(expandBtn).toBeVisible({ timeout: 20000 })
    await expandBtn.scrollIntoViewIfNeeded()
    await expandBtn.click()

    const targetInput = page.getByPlaceholder('輸入目標價').first()
    await expect(targetInput).toBeVisible({ timeout: 10000 })

    // 若已有既存目標價先清空
    await targetInput.fill('')
    await expect(targetInput).toHaveValue('')

    // 輸入 0 —— 不得被視作 falsy 吞成空白 / null
    await targetInput.fill('0')
    await expect(targetInput).toHaveValue('0')

    // 「距目標」提示應出現且為 -100.0%（(0 - price)/price * 100）
    await expect(page.getByText(/距目標\s*-100\.0%/)).toBeVisible({ timeout: 5000 })

    // 折疊
    const collapseBtn = page.getByRole('button', { name: '收起' }).first()
    await collapseBtn.click()
    await expect(page.getByPlaceholder('輸入目標價')).toHaveCount(0)

    // 重新展開 —— 儲存值須為 0 而非空白 / null
    await page.getByRole('button', { name: '展開' }).first().click()
    const reopened = page.getByPlaceholder('輸入目標價').first()
    await expect(reopened).toBeVisible()
    await expect(reopened).toHaveValue('0')
    await expect(page.getByText(/距目標\s*-100\.0%/)).toBeVisible()
  })
})
