/**
 * Shell Event Bus — pure pub/sub, no React.
 *
 * 契約與使用約定：docs/architecture/shell-event-bus-tdd.md §2
 *
 * 深模組（M1 Holdings / M2 Closing / M3 Events / M4 TradeIO / M5 Research）
 * 之間唯一允許的「主動跳轉」/「跨模組通知」通道。模組只 emit，Shell 層或
 * 目標模組 listen 並執行副作用（例：navigate / re-fetch）。
 */

/** 事件名 → payload 型別對應。擴充新事件時只改這裡與 doc §2 表格。 */
export interface ShellEvents {
  /** M2 Closing / M3 Events → M1 Holdings：跳到持倉並展開個股 */
  'holdings:focus': {
    stockCode: string
    source: 'closing' | 'events'
  }
  /** M1 Holdings → M2 Closing：跳到收盤分析並鎖定股票（可選鎖定日期） */
  'closing:openStock': {
    stockCode: string
    date?: string
    source: 'holdings'
  }
  /** M2 Closing / M3 Events → M5 Research：跳到研究工作台並預填股票／主題 */
  'research:prefill': {
    stockCode: string
    topic?: string
    source: 'closing' | 'events'
  }
  /** M4 TradeIO → M3 Events：交易寫入完成後要求事件面板重新拉資料 */
  'events:refresh': {
    reason: 'trade-import' | 'trade-manual' | 'ocr' | string
    source: 'tradeIO'
  }
}

export type ShellEventName = keyof ShellEvents
export type ShellEventHandler<E extends ShellEventName> = (payload: ShellEvents[E]) => void

export interface ShellEventBus {
  on<E extends ShellEventName>(event: E, handler: ShellEventHandler<E>): () => void
  off<E extends ShellEventName>(event: E, handler: ShellEventHandler<E>): void
  emit<E extends ShellEventName>(event: E, payload: ShellEvents[E]): void
}

export function createShellEventBus(): ShellEventBus {
  // Set 去重；每個事件名一組 handlers。
  const registry = new Map<ShellEventName, Set<ShellEventHandler<ShellEventName>>>()

  function bucket<E extends ShellEventName>(event: E): Set<ShellEventHandler<E>> {
    let set = registry.get(event) as Set<ShellEventHandler<E>> | undefined
    if (!set) {
      set = new Set()
      registry.set(event, set as unknown as Set<ShellEventHandler<ShellEventName>>)
    }
    return set
  }

  return {
    on(event, handler) {
      const set = bucket(event)
      set.add(handler)
      return () => set.delete(handler)
    },
    off(event, handler) {
      registry.get(event)?.delete(handler as ShellEventHandler<ShellEventName>)
    },
    emit(event, payload) {
      const set = registry.get(event)
      if (!set || set.size === 0) return
      // 快照避免 handler 內動態 on/off 影響本輪迭代；handler 錯誤隔離。
      for (const handler of Array.from(set)) {
        try {
          ;(handler as ShellEventHandler<typeof event>)(payload)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[shell-event-bus] handler for "${event}" threw:`, err)
        }
      }
    },
  }
}
