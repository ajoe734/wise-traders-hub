/**
 * M1 Holdings → Shell bus emit helper（closing:openStock）。
 * 契約：docs/architecture/shell-event-bus.md §2
 *
 * 禁止 M1 直接 import M2 內部檔案；跨模組跳轉一律走 shell bus。
 */
import { useCallback } from 'react'
import { useShellEventBus } from '../../shell/ShellEventBusProvider'

export function useEmitClosingOpenStock(): (stockCode: string, date?: string) => void {
  const bus = useShellEventBus()
  return useCallback(
    (stockCode: string, date?: string) => {
      bus.emit('closing:openStock', { stockCode, date, source: 'holdings' })
    },
    [bus],
  )
}
