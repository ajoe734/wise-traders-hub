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
    const { result } = renderHook(() => useSectorFilterPresets())
    act(() => { result.current.save('TestName', [{ kind: 'industry', key: 'A' }], 'union') })
    let r2
    act(() => { r2 = result.current.save('testname', [{ kind: 'industry', key: 'B' }], 'union') })
    expect(r2.error).toBe('DUPLICATE_NAME')
  })

  it('save blocks same name with surrounding whitespace', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const { result } = renderHook(() => useSectorFilterPresets())
    act(() => { result.current.save('TestName', [{ kind: 'industry', key: 'A' }], 'union') })
    let r2
    act(() => { r2 = result.current.save('  TestName  ', [{ kind: 'industry', key: 'B' }], 'union') })
    expect(r2.error).toBe('DUPLICATE_NAME')
  })

  it('rename blocks name differing only by case', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const { result } = renderHook(() => useSectorFilterPresets())
    let presetA, presetB
    act(() => { presetA = result.current.save('Alpha', [{ kind: 'industry', key: 'A' }], 'union') })
    act(() => { presetB = result.current.save('Beta', [{ kind: 'industry', key: 'B' }], 'union') })
    let renameResult
    act(() => { renameResult = result.current.rename(presetB.preset.id, 'ALPHA') })
    expect(renameResult.error).toBe('DUPLICATE_NAME')
  })

  it('rename blocks name differing only by whitespace', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const { result } = renderHook(() => useSectorFilterPresets())
    let presetA, presetB
    act(() => { presetA = result.current.save('Alpha', [{ kind: 'industry', key: 'A' }], 'union') })
    act(() => { presetB = result.current.save('Beta', [{ kind: 'industry', key: 'B' }], 'union') })
    let renameResult
    act(() => { renameResult = result.current.rename(presetB.preset.id, '  Alpha  ') })
    expect(renameResult.error).toBe('DUPLICATE_NAME')
  })

  it('rename allows same name on same preset (case change)', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const { result } = renderHook(() => useSectorFilterPresets())
    let preset
    act(() => { preset = result.current.save('Alpha', [{ kind: 'industry', key: 'A' }], 'union') })
    let renameResult
    act(() => { renameResult = result.current.rename(preset.preset.id, 'alpha') })
    expect(renameResult.ok).toBe(true)
  })

  it('save allows truly distinct names', async () => {
    const { useSectorFilterPresets } = await loadModule()
    const { result } = renderHook(() => useSectorFilterPresets())
    let r1, r2
    act(() => { r1 = result.current.save('AAA', [{ kind: 'industry', key: 'A' }], 'union') })
    act(() => { r2 = result.current.save('BBB', [{ kind: 'industry', key: 'B' }], 'union') })
    expect(r1.error).toBeUndefined()
    expect(r2.error).toBeUndefined()
    expect(r2.preset).toBeDefined()
  })
})
