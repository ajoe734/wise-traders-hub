// @ts-nocheck
/**
 * 持倉族群篩選預設（localStorage 儲存）
 *
 * 資料形狀：
 *   { id, name, items: [{kind:'industry'|'theme'|'strategy', key:string}], mode:'union'|'intersection', createdAt:number }
 */
import { useCallback, useEffect, useState } from 'react'

const KEY = 'checkup:sectorFilterPresets:v1'

function read() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((p) => p && Array.isArray(p.items)) : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {}
}

function uid() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase()
}

export function useSectorFilterPresets() {
  const [presets, setPresets] = useState(() => read())

  // 跨 tab 同步
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === KEY) setPresets(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Bug A3 fix：write() 是副作用，不能塞在 setState updater 內。
  // React 18 Strict Mode 會執行 updater 兩次，會造成 localStorage 與 state 不一致。
  // 統一改為：read → 計算 next → write → setPresets(next)（一般 setter）。
  const save = useCallback((name, items, mode) => {
    const trimmed = String(name || '').trim()
    if (!trimmed || !Array.isArray(items) || items.length === 0) return { error: 'INVALID' }
    const existing = read()
    const conflict = existing.find((p) => normalizeName(p.name) === normalizeName(trimmed))
    if (conflict) {
      return { error: 'DUPLICATE_NAME', conflict: { id: conflict.id, name: conflict.name } }
    }
    const preset = {
      id: uid(),
      name: trimmed.slice(0, 40),
      items: items.map((it) => ({ kind: it.kind, key: it.key })),
      mode: mode === 'intersection' ? 'intersection' : 'union',
      createdAt: Date.now(),
    }
    const next = [preset, ...existing].slice(0, 20)
    write(next)
    setPresets(next)
    return { preset }
  }, [])

  const remove = useCallback((id) => {
    const existing = read()
    const next = existing.filter((p) => p.id !== id)
    write(next)
    setPresets(next)
  }, [])

  const rename = useCallback((id, name) => {
    const trimmed = String(name || '').trim()
    if (!trimmed) return { error: 'INVALID' }
    const existing = read()
    const conflict = existing.find(
      (p) => normalizeName(p.name) === normalizeName(trimmed) && p.id !== id,
    )
    if (conflict) {
      return { error: 'DUPLICATE_NAME', conflict: { id: conflict.id, name: conflict.name } }
    }
    const next = existing.map((p) =>
      p.id === id ? { ...p, name: trimmed.slice(0, 40) } : p,
    )
    write(next)
    setPresets(next)
    return { ok: true }
  }, [])


  return { presets, save, remove, rename }
}

export const __TEST__ = { KEY, read, write }
