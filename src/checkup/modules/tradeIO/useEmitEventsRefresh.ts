/**
 * M4 TradeIO → Shell bus emit helper（events:refresh）。
 * 契約：docs/architecture/shell-event-bus-tdd.md §2
 *
 * 交易寫入 / OCR 匯入完成後呼叫，通知 M3 Events 重新拉資料。
 */
import { useCallback } from 'react'
import { useShellEventBus } from '../../shell/ShellEventBusProvider'
import type { ShellEvents } from '../../shell/eventBus'

type Reason = ShellEvents['events:refresh']['reason']

export function useEmitEventsRefresh(): (reason: Reason) => void {
  const bus = useShellEventBus()
  return useCallback(
    (reason: Reason) => {
      bus.emit('events:refresh', { reason, source: 'tradeIO' })
    },
    [bus],
  )
}
