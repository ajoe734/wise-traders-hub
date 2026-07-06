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

  const save = useCallback((name, items, mode) => {
    const trimmed = String(name || '').trim()
    if (!trimmed || !Array.isArray(items) || items.length === 0) return { error: 'INVALID' }
    const existing = read()
    if (existing.some((p) => normalizeName(p.name) === normalizeName(trimmed))) {
      return { error: 'DUPLICATE_NAME' }
    }
    const preset = {
      id: uid(),
      name: trimmed.slice(0, 40),
      items: items.map((it) => ({ kind: it.kind, key: it.key })),
      mode: mode === 'intersection' ? 'intersection' : 'union',
      createdAt: Date.now(),
    }
    setPresets((prev) => {
      const next = [preset, ...prev].slice(0, 20)
      write(next)
      return next
    })
    return { preset }
  }, [])

  const remove = useCallback((id) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== id)
      write(next)
      return next
    })
  }, [])

  const rename = useCallback((id, name) => {
    const trimmed = String(name || '').trim()
    if (!trimmed) return { error: 'INVALID' }
    const existing = read()
    if (existing.some((p) => normalizeName(p.name) === normalizeName(trimmed) && p.id !== id)) {
      return { error: 'DUPLICATE_NAME' }
    }
    setPresets((prev) => {
      const next = prev.map((p) =>
        p.id === id ? { ...p, name: trimmed.slice(0, 40) } : p,
      )
      write(next)
      return next
    })
    return { ok: true }
  }, [])

  return { presets, save, remove, rename }
}

export const __TEST__ = { KEY, read, write }
