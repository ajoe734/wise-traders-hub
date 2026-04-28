// 「去重策略」設定面板：浮動齒輪按鈕 + 簡易彈窗。
// 設計目標：不侵入 FreeCheckup.jsx 的大量 inline JSX（見 mem://architecture/checkup/inline-rendering-audit），
// 透過獨立掛點呈現，只在 /free-checkup 路徑下顯示。

import { useEffect, useState } from 'react'
import {
  getCoercePrefs,
  setCoercePrefs,
  resetCoercePrefs,
  subscribeCoercePrefs,
} from '@/checkup/lib/edgeCoercePrefs'

function useCurrentPath() {
  const [path, setPath] = useState(typeof window !== 'undefined' ? window.location.pathname : '/')
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onChange)
    // history.pushState 不會發 popstate，這裡攔截一下
    const orig = window.history.pushState
    window.history.pushState = function (...args) {
      const r = orig.apply(this, args as any)
      onChange()
      return r
    }
    return () => {
      window.removeEventListener('popstate', onChange)
      window.history.pushState = orig
    }
  }, [])
  return path
}

const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
    <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{label}</span>
    {hint && <span style={{ fontSize: 11, color: '#888' }}>{hint}</span>}
    <div style={{ marginTop: 6 }}>{children}</div>
  </label>
)

export function DedupSettingsButton() {
  const path = useCurrentPath()
  const [open, setOpen] = useState(false)
  const [prefs, setPrefsState] = useState(getCoercePrefs())

  useEffect(() => {
    const unsub = subscribeCoercePrefs(setPrefsState)
    return () => { unsub() }
  }, [])

  if (!path.startsWith('/free-checkup')) return null

  const update = (patch: Partial<typeof prefs>) => setPrefsState(setCoercePrefs(patch))

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="去重策略設定"
        aria-label="去重策略設定"
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 9998,
          width: 36, height: 36, borderRadius: '50%',
          background: '#fff', border: '1px solid rgba(0,0,0,0.12)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 16, color: '#555',
        }}
      >⚙︎</button>

      {open && (
        <div
          role="dialog"
          aria-label="去重策略設定"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.32)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#F5F3EF', borderRadius: 10, width: 360, maxWidth: '92vw',
            padding: 18, fontFamily: 'inherit',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>去重策略</h3>
              <button onClick={() => setOpen(false)} style={{ border: 0, background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#888' }}>×</button>
            </div>
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px 0', lineHeight: 1.6 }}>
              影響「持倉與股票輸入」自動修正時的去重行為（送出時也會套用）。
            </p>

            <Row label="重複時保留" hint="當同一筆出現多次，保留第一次或最後一次">
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => update({ strategy: 'keepFirst' })}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    background: prefs.strategy === 'keepFirst' ? '#1a1a1a' : '#fff',
                    color: prefs.strategy === 'keepFirst' ? '#fff' : '#333',
                    border: '1px solid rgba(0,0,0,0.12)',
                  }}>保留第一個</button>
                <button onClick={() => update({ strategy: 'keepLast' })}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    background: prefs.strategy === 'keepLast' ? '#1a1a1a' : '#fff',
                    color: prefs.strategy === 'keepLast' ? '#fff' : '#333',
                    border: '1px solid rgba(0,0,0,0.12)',
                  }}>保留最後一個</button>
              </div>
            </Row>

            <Row label="忽略空白差異" hint='開啟後，「2330 台積電」與「2330台積電」會視為同一筆'>
              <input type="checkbox" checked={prefs.ignoreWhitespace}
                onChange={(e) => update({ ignoreWhitespace: e.target.checked })} />
            </Row>

            <Row label="忽略全形/半形差異" hint="開啟後，全形英數標點會先轉半形再比對">
              <input type="checkbox" checked={prefs.normalizeWidth}
                onChange={(e) => update({ normalizeWidth: e.target.checked })} />
            </Row>

            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { resetCoercePrefs() }}
                style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, background: 'transparent', border: '1px solid rgba(0,0,0,0.12)', color: '#666', cursor: 'pointer' }}>
                還原預設
              </button>
              <button onClick={() => setOpen(false)}
                style={{ padding: '6px 14px', fontSize: 12, borderRadius: 6, background: '#1a1a1a', color: '#fff', border: 0, cursor: 'pointer' }}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
