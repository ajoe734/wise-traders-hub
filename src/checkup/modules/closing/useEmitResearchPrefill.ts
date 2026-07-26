/**
 * M2 Closing → Shell bus emit helper（research:prefill）。
 * 契約：docs/architecture/shell-event-bus-tdd.md §2
 */
import { useCallback } from 'react'
import { useShellEventBus } from '../../shell/ShellEventBusProvider'

export function useEmitResearchPrefill(): (stockCode: string, topic?: string) => void {
  const bus = useShellEventBus()
  return useCallback(
    (stockCode: string, topic?: string) => {
      bus.emit('research:prefill', { stockCode, topic, source: 'closing' })
    },
    [bus],
  )
}
