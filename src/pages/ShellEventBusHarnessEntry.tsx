/**
 * E2E harness — Shell Event Bus (docs/architecture/shell-event-bus.md §4 S5 / §8-2)
 *
 * 掛在 `/portfolio/:portfolioId/__shell-bus` 之下，因此天然位於 PortfolioLayout
 * 的 ShellEventBusProvider Context 內。點按鈕會透過各模組 barrel 的 emit helper
 * 發事件，Shell listener 應該 navigate 到對應 route。
 *
 * 覆蓋事件（v1 + v2）：
 *   - holdings:focus         → /portfolio/:id/holdings?expand=<code>
 *   - closing:openStock      → /portfolio/:id/daily?stock=<code>[&date=...]
 *   - research:prefill       → /portfolio/:id/research?stock=<code>[&topic=...]
 *   - events:refresh         → 由 EventsPage 的 beacon 觸發（見 ?bus_test=1）
 */
import { useState } from 'react'
import { useEmitHoldingsFocus as emitFromClosing } from '@/checkup/modules/closing'
import { useEmitHoldingsFocus as emitFromEvents } from '@/checkup/modules/events'
import { useEmitClosingOpenStock } from '@/checkup/modules/holdings'
import { useEmitResearchPrefill as emitResearchFromClosing } from '@/checkup/modules/closing'
import { useEmitResearchPrefill as emitResearchFromEvents } from '@/checkup/modules/events'

export default function ShellEventBusHarnessEntry() {
  const emitClosing = emitFromClosing()
  const emitEvents = emitFromEvents()
  const emitOpenStock = useEmitClosingOpenStock()
  const emitResearchC = emitResearchFromClosing()
  const emitResearchE = emitResearchFromEvents()
  const [code, setCode] = useState('2330')
  const [date, setDate] = useState('')
  const [topic, setTopic] = useState('')

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
      <label style={{ display: 'block', marginBottom: 12 }}>
        date (optional, YYYY-MM-DD):
        <input
          data-testid="harness-date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ marginLeft: 8, padding: '4px 8px' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 12 }}>
        topic (optional):
        <input
          data-testid="harness-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ marginLeft: 8, padding: '4px 8px' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="harness-emit-from-closing"
          onClick={() => emitClosing(code)}
        >
          Emit holdings:focus (from M2)
        </button>
        <button
          type="button"
          data-testid="harness-emit-from-events"
          onClick={() => emitEvents(code)}
        >
          Emit holdings:focus (from M3)
        </button>
        <button
          type="button"
          data-testid="harness-emit-closing-open-stock"
          onClick={() => emitOpenStock(code, date || undefined)}
        >
          Emit closing:openStock (M1)
        </button>
        <button
          type="button"
          data-testid="harness-emit-research-from-closing"
          onClick={() => emitResearchC(code, topic || undefined)}
        >
          Emit research:prefill (M2)
        </button>
        <button
          type="button"
          data-testid="harness-emit-research-from-events"
          onClick={() => emitResearchE(code, topic || undefined)}
        >
          Emit research:prefill (M3)
        </button>
      </div>
    </div>
  )
}
