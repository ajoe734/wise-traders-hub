/**
 * L5 · 跨模組契約
 *
 * 三條合法路：
 *   1. URL / route params — 由 e2e (module-cross-nav.spec.ts) 覆蓋
 *   2. 共用 store 唯讀 selector — 本檔覆蓋
 *   3. Shell event bus — 尚未實作，佔位 skip test
 *
 * 邊界規則：模組 A 的 barrel 不得 re-export 模組 B 的內部。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(process.cwd(), 'src/checkup/modules')
const MODULE_NAMES = ['holdings', 'closing', 'events', 'tradeIO', 'research'] as const

describe('L5 · 跨模組契約：barrel 邊界', () => {
  it('每個 barrel 只從自己的相對路徑或別的 checkup 共用層匯入，不得 import sibling module', () => {
    for (const mod of MODULE_NAMES) {
      const content = readFileSync(join(MODULES_DIR, mod, 'index.ts'), 'utf-8')
      for (const other of MODULE_NAMES) {
        if (other === mod) continue
        const forbidden = new RegExp(`from ['\"]\.\./${other}(/|['\"])`)
        expect(forbidden.test(content), `${mod}/index.ts 不得 import ../${other}`).toBe(false)
      }
    }
  })

  it('modules dir 只含 5 個已知模組（新增時記得更新架構文件）', () => {
    const dirs = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(dirs).toEqual([...MODULE_NAMES].sort())
  })
})

describe('L5 · 共用 store 唯讀 selector 契約', () => {
  it('store 的 setState 只給 store 自己用 — 消費者只能拿 selector', async () => {
    // Zustand store 本身一定有 setState / getState，這是實作細節而非契約。
    // 契約：每個 route hook 都只用 useXxxStore(selector) 語法拿值，不直接呼叫 setState。
    // 這裡以檔案掃描方式反向驗：hooks 目錄下不得出現 `useXxxStore.setState(`
    const hooksDir = join(process.cwd(), 'src/checkup/hooks')
    const files = readdirSync(hooksDir).filter((f) => f.startsWith('useRoute') && f.endsWith('.js'))
    for (const f of files) {
      const src = readFileSync(join(hooksDir, f), 'utf-8')
      expect(
        /\buse[A-Z]\w*Store\.setState\s*\(/.test(src),
        `${f} 不得直接呼叫 store.setState — 請走 setter action`,
      ).toBe(false)
    }
  })
})

describe.skip('L5 · Shell event bus（TODO PR）', () => {
  it.skip('EventCard → Holdings 跳轉走 shell bus 而非 sibling import', () => {
    // placeholder：待 shell event bus 實作後，這裡加真正的訂閱/發布測試
  })
})
