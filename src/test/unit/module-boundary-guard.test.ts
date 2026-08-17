/**
 * C1 · Checkup 深模組邊界守衛（機制化）
 * 契約：docs/adr/0001-checkup-five-deep-modules.md
 *
 * 這支測試同時驗證「守衛本身會抓錯」與「現況 0 violation」，
 * 避免守衛因為 regex 寫壞而變成永遠綠燈的假保險。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkModuleBoundaries,
  deriveOwnership,
  CHECKUP_MODULES,
} from '../../../scripts/moduleBoundaries.mjs'

const MODULES = ['holdings', 'closing', 'events', 'tradeIO', 'research']

/**
 * 真實 repo 的全樹掃描是同步 I/O，平行跑整個 suite 時可能超過預設 5s。
 * 掃一次快取重用，並給予明確較長 timeout，避免負載造成的偽紅燈。
 */
const SCAN_TIMEOUT = 60_000
let realScanCache: ReturnType<typeof checkModuleBoundaries> | null = null
const realScan = () => (realScanCache ??= checkModuleBoundaries())
let realOwnersCache: ReturnType<typeof deriveOwnership> | null = null
const realOwners = () => (realOwnersCache ??= deriveOwnership(join(process.cwd(), 'src'), MODULES))

describe('C1 · 深模組邊界守衛 — 真實 repo', () => {
  it('模組清單與 5 深模組一致', () => {
    expect(CHECKUP_MODULES).toEqual(MODULES)
  })

  it('每個模組都有 barrel（R3）', () => {
    const v = realScan().filter((x) => x.rule === 'R3_MISSING_BARREL')
    expect(v).toEqual([])
  }, SCAN_TIMEOUT)

  it('現況 0 violation（R1/R2/R3/R4 全數）', () => {
    const v = realScan()
    expect(v.map((x) => `${x.rule} ${x.file} → ${x.specifier}`)).toEqual([])
  }, SCAN_TIMEOUT)

  it('barrel 推導出的擁有權涵蓋 components / pages / hooks 實作層', () => {
    const owners = realOwners()
    expect(owners.get('src/checkup/components/holdings')).toBe('holdings')
    expect(owners.get('src/checkup/pages/EventsPage')).toBe('events')
    expect(owners.get('src/checkup/hooks/useRouteResearchPage')).toBe('research')
    expect(owners.get('src/checkup/components/trade')).toBe('tradeIO')
    expect(owners.get('src/checkup/components/reports')).toBe('closing')
  }, SCAN_TIMEOUT)
})

describe('C1 · 深模組邊界守衛 — 合成違規必須被抓到', () => {
  let root: string

  const write = (rel: string, body: string) => {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body, 'utf-8')
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mod-boundary-'))
    for (const m of ['holdings', 'closing']) {
      write(
        `src/checkup/modules/${m}/index.ts`,
        `export { Panel } from '../../components/${m}/index.js'\n`,
      )
      write(`src/checkup/components/${m}/index.js`, `export const Panel = () => null\n`)
    }
    // R1：holdings 內部 import 手足 closing
    write(
      'src/checkup/modules/holdings/bad.ts',
      `import { x } from '@/checkup/modules/closing'\nexport const y = x\n`,
    )
    // R4：holdings 擁有的元件 import 手足元件目錄
    write(
      'src/checkup/components/holdings/Bad.jsx',
      `import { z } from '../closing/index.js'\nexport const A = z\n`,
    )
    // R2：模組外部深挖內部檔案
    write(
      'src/pages/Outside.tsx',
      `import { thing } from '@/checkup/modules/closing/internal/thing'\nexport const B = thing\n`,
    )
    // 合法：外部只走 barrel
    write('src/pages/Ok.tsx', `import { Panel } from '@/checkup/modules/closing'\nexport const C = Panel\n`)
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const run = () =>
    checkModuleBoundaries({ root, modules: ['holdings', 'closing', 'events', 'tradeIO', 'research'] })

  it('抓到 R1 手足 import', () => {
    expect(run().some((v) => v.rule === 'R1_SIBLING_IMPORT' && v.file.endsWith('bad.ts'))).toBe(true)
  })

  it('抓到 R4 手足元件目錄 import', () => {
    expect(run().some((v) => v.rule === 'R4_SIBLING_COMPONENTS' && v.file.endsWith('Bad.jsx'))).toBe(true)
  })

  it('抓到 R2 外部 deep import', () => {
    expect(run().some((v) => v.rule === 'R2_DEEP_IMPORT' && v.file.endsWith('Outside.tsx'))).toBe(true)
  })

  it('抓到 R3 缺 barrel（events/tradeIO/research 未建立）', () => {
    const missing = run().filter((v) => v.rule === 'R3_MISSING_BARREL').map((v) => v.file)
    expect(missing).toEqual([
      'src/checkup/modules/events',
      'src/checkup/modules/tradeIO',
      'src/checkup/modules/research',
    ])
  })

  it('走 barrel 的外部呼叫端不被誤判', () => {
    expect(run().some((v) => v.file.endsWith('Ok.tsx'))).toBe(false)
  })
})

describe('C1 · R5 free surface 守衛（ADR-0005 §7）', () => {
  it('真實 repo 現況 0 筆 R5 違規', () => {
    const v = realScan().filter((x) => x.rule.startsWith('R5_'))
    expect(v.map((x) => `${x.rule} ${x.file} → ${x.specifier}`)).toEqual([])
  }, SCAN_TIMEOUT)

  it('每個 freecheckup 實作檔都被 barrel 認領（shell 自有 UI 除外）', () => {
    const owners = realOwners()
    expect(owners.get('src/checkup/components/freecheckup/HoldingsTab')).toBe('holdings')
    expect(owners.get('src/checkup/components/freecheckup/DailyTab')).toBe('closing')
    expect(owners.get('src/checkup/components/freecheckup/EventsTab')).toBe('events')
    expect(owners.get('src/checkup/components/freecheckup/TradeTab')).toBe('tradeIO')
    expect(owners.get('src/checkup/components/freecheckup/ResearchTab')).toBe('research')
    // shell 自有 UI 不歸任何模組
    expect(owners.get('src/checkup/components/freecheckup/OnboardingOverlay')).toBeUndefined()
  }, SCAN_TIMEOUT)

  describe('合成違規', () => {
    let root: string
    const write = (rel: string, body: string) => {
      const abs = join(root, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, body, 'utf-8')
    }

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'r5-boundary-'))
      write(
        'src/checkup/modules/holdings/index.ts',
        `export { Panel } from '../../components/holdings/index.js'\n`,
      )
      write('src/checkup/components/holdings/index.js', `export const Panel = () => null\n`)
      write(
        'src/checkup/modules/holdings/free.ts',
        `export { default as HoldingsTab } from '../../components/freecheckup/HoldingsTab';\n`,
      )
      write('src/checkup/components/freecheckup/HoldingsTab.tsx', `export default () => null\n`)
      // R5a：新檔沒被任何 barrel 認領
      write('src/checkup/components/freecheckup/OrphanTab.tsx', `export default () => null\n`)
      // shell 自有 UI（白名單）
      write('src/checkup/components/freecheckup/OnboardingOverlay.jsx', `export default () => null\n`)
      // R5b：shell 深挖實作檔
      write(
        'src/pages/FreeCheckup.jsx',
        `import HoldingsTab from '@/checkup/components/freecheckup/HoldingsTab'\n` +
          `import Overlay from '@/checkup/components/freecheckup/OnboardingOverlay'\n` +
          `export const A = [HoldingsTab, Overlay]\n`,
      )
      // 合法：走 free barrel
      write(
        'src/pages/Ok.tsx',
        `import { HoldingsTab } from '@/checkup/modules/holdings/free'\nexport const B = HoldingsTab\n`,
      )
      // 例外：harness 入口允許深挖
      write(
        'src/pages/HoldingCardHarnessEntry.tsx',
        `import T from '@/checkup/components/freecheckup/HoldingsTab'\nexport const C = T\n`,
      )
    })

    afterAll(() => rmSync(root, { recursive: true, force: true }))

    const run = () => checkModuleBoundaries({ root, modules: MODULES })

    it('抓到 R5a 未被認領的 freecheckup 檔', () => {
      const v = run().filter((x) => x.rule === 'R5_UNOWNED_FREE_FILE').map((x) => x.file)
      expect(v).toContain('src/checkup/components/freecheckup/OrphanTab.tsx')
    })

    it('shell 自有 UI（OnboardingOverlay）不算未認領', () => {
      const v = run().filter((x) => x.rule === 'R5_UNOWNED_FREE_FILE').map((x) => x.file)
      expect(v).not.toContain('src/checkup/components/freecheckup/OnboardingOverlay.jsx')
    })

    it('抓到 R5b shell 深挖實作檔', () => {
      const v = run().filter((x) => x.rule === 'R5_FREE_DEEP_IMPORT')
      expect(v.some((x) => x.file === 'src/pages/FreeCheckup.jsx' && x.specifier.endsWith('HoldingsTab'))).toBe(true)
    })

    it('shell 自有 UI 的 import 不被誤判', () => {
      const v = run().filter((x) => x.rule === 'R5_FREE_DEEP_IMPORT')
      expect(v.some((x) => x.specifier.endsWith('OnboardingOverlay'))).toBe(false)
    })

    it('走 free barrel 與 harness 入口不被誤判', () => {
      const v = run().filter((x) => x.rule === 'R5_FREE_DEEP_IMPORT').map((x) => x.file)
      expect(v).not.toContain('src/pages/Ok.tsx')
      expect(v).not.toContain('src/pages/HoldingCardHarnessEntry.tsx')
    })
  })
})
