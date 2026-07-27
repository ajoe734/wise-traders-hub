/**
 * M2 Closing → Shell bus emit helper.
 * 契約：docs/architecture/shell-event-bus.md §2
 *
 * 使用：
 *   const emitFocus = useEmitHoldingsFocus();
 *   emitFocus('2330');
 *
 * 禁止 M2 直接 import M1 內部檔案；跨模組跳轉一律走 shell bus。
 */
import { useCallback } from 'react'
import { useShellEventBus } from '../../shell/ShellEventBusProvider'

export function useEmitHoldingsFocus(): (stockCode: string) => void {
  const bus = useShellEventBus()
  return useCallback(
    (stockCode: string) => {
      bus.emit('holdings:focus', { stockCode, source: 'closing' })
    },
    [bus],
  )
}
