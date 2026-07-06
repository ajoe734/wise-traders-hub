import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// SectorFilterPresets 模組在 import 時會讀取 localStorage，
// 因此必須先 mock。
const storage: Record<string, string> = {}

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
  },
  writable: true,
})

// 動態 import 以確保模組讀到 mock 後的 localStorage
async function loadModule() {
  // 先清除模組快取，讓重新 import 生效
  vi.resetModules()
  // @ts-ignore
  return await import('@/checkup/lib/sectorFilterPresets')
}

describe('sectorFilterPresets duplicate name checks (case & whitespace insensitive)', () => {
  beforeEach(() => {
    Object.keys(storage).forEach((k) => delete storage[k])
  })

  it('save blocks same name with different casing', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const hook = useSectorFilterPresets()
    hook.save('TestName', [{ kind: 'industry', key: 'A' }], 'union')
    const result = hook.save('testname', [{ kind: 'industry', key: 'B' }], 'union')
    expect(result.error).toBe('DUPLICATE_NAME')
  })

  it('save blocks same name with surrounding whitespace', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const hook = useSectorFilterPresets()
    hook.save('TestName', [{ kind: 'industry', key: 'A' }], 'union')
    const result = hook.save('  TestName  ', [{ kind: 'industry', key: 'B' }], 'union')
    expect(result.error).toBe('DUPLICATE_NAME')
  })

  it('rename blocks name differing only by case', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const hook = useSectorFilterPresets()
    hook.save('Alpha', [{ kind: 'industry', key: 'A' }], 'union')
    const presetB = hook.save('Beta', [{ kind: 'industry', key: 'B' }], 'union').preset
    const result = hook.rename(presetB.id, 'ALPHA')
    expect(result.error).toBe('DUPLICATE_NAME')
  })

  it('rename blocks name differing only by whitespace', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const hook = useSectorFilterPresets()
    hook.save('Alpha', [{ kind: 'industry', key: 'A' }], 'union')
    const presetB = hook.save('Beta', [{ kind: 'industry', key: 'B' }], 'union').preset
    const result = hook.rename(presetB.id, '  Alpha  ')
    expect(result.error).toBe('DUPLICATE_NAME')
  })

  it('rename allows same name on same preset (case change)', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const hook = useSectorFilterPresets()
    const preset = hook.save('Alpha', [{ kind: 'industry', key: 'A' }], 'union').preset
    const result = hook.rename(preset.id, 'alpha')
    expect(result.ok).toBe(true)
  })

  it('save allows truly distinct names', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const hook = useSectorFilterPresets()
    const r1 = hook.save('AAA', [{ kind: 'industry', key: 'A' }], 'union')
    expect(r1.error).toBeUndefined()
    const r2 = hook.save('BBB', [{ kind: 'industry', key: 'B' }], 'union')
    expect(r2.error).toBeUndefined()
    expect(r2.preset).toBeDefined()
  })
})
