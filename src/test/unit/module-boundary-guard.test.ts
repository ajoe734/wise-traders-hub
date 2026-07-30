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

describe('C1 · 深模組邊界守衛 — 真實 repo', () => {
  it('模組清單與 5 深模組一致', () => {
    expect(CHECKUP_MODULES).toEqual(MODULES)
  })

  it('每個模組都有 barrel（R3）', () => {
    const v = checkModuleBoundaries().filter((x) => x.rule === 'R3_MISSING_BARREL')
    expect(v).toEqual([])
  })

  it('現況 0 violation（R1/R2/R3/R4 全數）', () => {
    const v = checkModuleBoundaries()
    expect(v.map((x) => `${x.rule} ${x.file} → ${x.specifier}`)).toEqual([])
  })

  it('barrel 推導出的擁有權涵蓋 components / pages / hooks 實作層', () => {
    const owners = deriveOwnership(join(process.cwd(), 'src'), MODULES)
    expect(owners.get('src/checkup/components/holdings')).toBe('holdings')
    expect(owners.get('src/checkup/pages/EventsPage')).toBe('events')
    expect(owners.get('src/checkup/hooks/useRouteResearchPage')).toBe('research')
    expect(owners.get('src/checkup/components/trade')).toBe('tradeIO')
    expect(owners.get('src/checkup/components/reports')).toBe('closing')
  })
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
