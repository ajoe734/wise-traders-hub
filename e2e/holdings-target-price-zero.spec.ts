/**
 * E2E 回歸 — 持倉看板：目標價輸入 0
 *
 * 保護 `HoldingsTable` 的 target-price 邏輯不再退化為
 *   - `e.target.value ? Number(...) : null`（會把 "0" 當 falsy 存成 null）
 *   - `holding.targetPrice ?? ''`（若改回 `||` 會把 0 顯示成空白）
 *
 * 走 preview-only harness `/e2e/holdings-table-target-harness`，
 * 直接掛 `<HoldingsTable>` 單卡片：
 *   `[data-testid="target-value"]` 顯示實際被寫回 state 的值（0 vs null vs "0"）。
 *
 * 驗證：
 *   1) 輸入 0 → input value 為 "0"，寫回 state 為數字 0（不是 null / 空白 / 字串）
 *   2) 「距目標」提示應出現且為 -100.0%
 *   3) 折疊 → 重新展開後 input 仍顯示 "0"
 *   4) 清空 input 才會寫回 null（負向對照組）
 */
import { test, expect } from '@playwright/test'

test.describe('持倉看板 · 目標價 = 0 回歸', () => {
  test('輸入 0：顯示 "0"、寫回數字 0、距目標 -100.0%、折疊再展開仍保留', async ({ page }) => {
    await page.goto('/e2e/holdings-table-target-harness', { waitUntil: 'domcontentloaded' })

    // 初始：expanded=2330，input 可見；state.targetPrice = null
    const targetValue = page.getByTestId('target-value')
    await expect(targetValue).toHaveText('null')

    const input = page.getByPlaceholder('輸入目標價')
    await expect(input).toBeVisible({ timeout: 10000 })
    await expect(input).toHaveValue('')

    // 輸入 0 —— 不得被 falsy 吞掉
    await input.fill('0')
    await expect(input).toHaveValue('0')
    // 寫回 state 應為數字 0（JSON.stringify(0) === "0"），不得是 "null" 或字串 "0"
    await expect(targetValue).toHaveText('0')

    // 距目標 -100.0%（(0 - 600) / 600 * 100）
    await expect(page.getByText(/距目標\s*-100\.0%/)).toBeVisible()

    // 折疊
    await page.getByRole('button', { name: '收起' }).first().click()
    await expect(page.getByPlaceholder('輸入目標價')).toHaveCount(0)

    // 重新展開 —— 儲存值須仍為 0，input 顯示 "0"
    await page.getByRole('button', { name: '展開' }).first().click()
    const reopened = page.getByPlaceholder('輸入目標價')
    await expect(reopened).toBeVisible()
    await expect(reopened).toHaveValue('0')
    await expect(targetValue).toHaveText('0')
    await expect(page.getByText(/距目標\s*-100\.0%/)).toBeVisible()

    // 負向對照：清空 → 寫回 null（區分「使用者刪除」vs「使用者輸入 0」）
    await reopened.fill('')
    await expect(reopened).toHaveValue('')
    await expect(targetValue).toHaveText('null')
    // 距目標提示應消失
    await expect(page.getByText(/距目標/)).toHaveCount(0)
  })
})
