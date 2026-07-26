/**
 * E2E harness — Shell Event Bus (docs/architecture/shell-event-bus-tdd.md §4 S5)
 *
 * 掛在 `/portfolio/:portfolioId/__shell-bus` 之下，因此天然位於 PortfolioLayout
 * 的 ShellEventBusProvider Context 內；點按鈕會透過 M2/M3 barrel 的
 * useEmitHoldingsFocus emit，Shell listener 應該 navigate 到
 * `/portfolio/:id/holdings?expand=<stockCode>`。
 */
import { useState } from 'react'
import { useEmitHoldingsFocus as emitFromClosing } from '@/checkup/modules/closing'
import { useEmitHoldingsFocus as emitFromEvents } from '@/checkup/modules/events'

export default function ShellEventBusHarnessEntry() {
  const emitClosing = emitFromClosing()
  const emitEvents = emitFromEvents()
  const [code, setCode] = useState('2330')

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1 data-testid="harness-title">Shell Event Bus Harness</h1>
      <label style={{ display: 'block', marginBottom: 12 }}>
        stockCode:
        <input
          data-testid="harness-stock-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ marginLeft: 8, padding: '4px 8px' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          data-testid="harness-emit-from-closing"
          onClick={() => emitClosing(code)}
        >
          Emit from M2 (closing)
        </button>
        <button
          type="button"
          data-testid="harness-emit-from-events"
          onClick={() => emitEvents(code)}
        >
          Emit from M3 (events)
        </button>
      </div>
    </div>
  )
}
