/**
 * L4 · 深模組 Route E2E 煙霧測試
 *
 * 目的：實際 goto 7 條 `/portfolio/me/*` 路由，驗每個深模組能真的 render、
 * 沒有 console error、頁面有可辨識的區塊。
 *
 * 抓的是：barrel/hook/store 三者接線斷掉 → route 白畫面或 boundary 接住 error。
 * 每個路由收 console.error，失敗時列印以便快速定位。
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoWithRetry } from './helpers/navigation'

const ROUTES: Array<{ path: string; label: string; expectText: RegExp }> = [
  { path: '/portfolio/me/holdings', label: 'M1 Holdings', expectText: /持倉|Holdings|尚無持股|載入中/ },
  { path: '/portfolio/me/daily', label: 'M2 Closing/Daily', expectText: /收盤|分析|Daily|尚未|開始/ },
  { path: '/portfolio/me/news', label: 'M2 Closing/News', expectText: /新聞|事件|News|尚未/ },
  { path: '/portfolio/me/events', label: 'M3 Events', expectText: /行事曆|事件|Events|全部|尚無/ },
  { path: '/portfolio/me/trade', label: 'M4 TradeIO/Trade', expectText: /交易|上傳|OCR|Trade/ },
  { path: '/portfolio/me/log', label: 'M4 TradeIO/Log', expectText: /日誌|Log|尚無|紀錄/ },
  { path: '/portfolio/me/research', label: 'M5 Research', expectText: /研究|Research|尚無|輸入|標的/ },
]

// 允許的 warning noise（第三方 script、Radix 開發訊息等）
const IGNORE_ERROR_PATTERNS: RegExp[] = [
  /React DevTools/i,
  /Download the React DevTools/i,
  /Warning: .* deprecated/i,
  /favicon\.ico/i,
  /Failed to load resource.*supabase/i, // demo route 允許 supabase 401
  /net::ERR_ABORTED/i,
]

async function collectConsole(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORE_ERROR_PATTERNS.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on('pageerror', (err) => {
    const text = err.message
    if (IGNORE_ERROR_PATTERNS.some((re) => re.test(text))) return
    errors.push(`[pageerror] ${text}`)
  })
  return errors
}

for (const route of ROUTES) {
  test.describe(`${route.label} · ${route.path}`, () => {
    test('route render 不炸、無 console.error、看得到辨識文字', async ({ page }) => {
      // primeDemo：與既有 holdings e2e 對齊，跳過 onboarding modal
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('checkup-coach-seen-v1', '1')
          window.localStorage.setItem('holdings-intro-video-seen-v2', '1')
          window.localStorage.setItem('lf.checkup.onboarded', '1')
          window.localStorage.setItem('checkup-onboarding-tour-v1', 'done')
        } catch {}
      })

      const errors = await collectConsole(page)
      await gotoWithRetry(page, route.path, { waitUntil: 'domcontentloaded' })

      // 等 React 掛載 + 允許 Suspense fallback 消化
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

      // 驗 body 有 render（root 不是 empty）
      const bodyText = await page.locator('body').innerText()
      expect(bodyText.length, `${route.path} body 空白（可能整頁白畫面）`).toBeGreaterThan(20)

      // 驗辨識文字出現（其中之一）
      expect(bodyText, `${route.path} 找不到模組辨識文字`).toMatch(route.expectText)

      // 驗 ErrorBoundary 沒有被觸發（含 fallback 文案 "頁面發生錯誤" / "Something went wrong"）
      expect(bodyText, `${route.path} 觸發 ErrorBoundary fallback`).not.toMatch(
        /頁面發生錯誤|Something went wrong|模組載入失敗/i,
      )

      // 驗 console 無非白名單 error
      if (errors.length > 0) {
        console.error(`${route.label} console errors:\n${errors.join('\n---\n')}`)
      }
      expect(errors, `${route.path} 有 console.error 汙染`).toEqual([])
    })
  })
}
