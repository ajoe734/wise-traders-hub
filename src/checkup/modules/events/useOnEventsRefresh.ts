/**
 * M3 Events → Shell bus subscribe helper（events:refresh）。
 * 契約：docs/architecture/shell-event-bus-tdd.md §2
 *
 * EventsPanel 內呼叫本 hook；當 M4 TradeIO emit 'events:refresh' 時執行 callback
 * （通常是重新拉事件清單）。
 */
import { useShellEventListener } from '../../shell/ShellEventBusProvider'
import type { ShellEvents } from '../../shell/eventBus'

export function useOnEventsRefresh(
  handler: (payload: ShellEvents['events:refresh']) => void,
): void {
  useShellEventListener('events:refresh', handler)
}
