/**
 * ShellEventBusProvider — React binding for the shell event bus.
 *
 * 契約：docs/architecture/shell-event-bus-tdd.md
 *
 * Usage:
 *   <ShellEventBusProvider>
 *     <PortfolioLayout />   // 內部 useHoldingsFocusNavigation(portfolioId)
 *   </ShellEventBusProvider>
 *
 * 模組端只透過 barrel 拿 emit helper（見 modules/closing|events/index.ts），
 * 禁止跨模組深 import。
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createShellEventBus,
  type ShellEventBus,
  type ShellEventHandler,
  type ShellEventName,
  type ShellEvents,
} from './eventBus'

const ShellEventBusContext = createContext<ShellEventBus | null>(null)

export interface ShellEventBusProviderProps {
  children: ReactNode
  /** 測試用：注入外部 bus 以便斷言。正式使用不要傳。 */
  bus?: ShellEventBus
}

export function ShellEventBusProvider({ children, bus }: ShellEventBusProviderProps) {
  const value = useMemo(() => bus ?? createShellEventBus(), [bus])
  return (
    <ShellEventBusContext.Provider value={value}>{children}</ShellEventBusContext.Provider>
  )
}

export function useShellEventBus(): ShellEventBus {
  const ctx = useContext(ShellEventBusContext)
  if (!ctx) {
    throw new Error(
      'useShellEventBus() must be used inside <ShellEventBusProvider>. ' +
        'Wrap the shell (e.g. PortfolioLayout) with ShellEventBusProvider.',
    )
  }
  return ctx
}

/**
 * 訂閱單一事件；handler 保持最新閉包（用 ref 避免每次 re-subscribe）。
 * 卸載自動解除。
 */
export function useShellEventListener<E extends ShellEventName>(
  event: E,
  handler: ShellEventHandler<E>,
): void {
  const bus = useShellEventBus()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const unsub = bus.on(event, ((payload: ShellEvents[E]) => {
      handlerRef.current(payload)
    }) as ShellEventHandler<E>)
    return unsub
  }, [bus, event])
}

/**
 * Shell 側裝配：將 `holdings:focus` 事件轉為 route navigation。
 * 只應在 PortfolioLayout 這類 shell 元件中掛一次。
 */
export function useHoldingsFocusNavigation(portfolioId: string | undefined | null): void {
  const navigate = useNavigate()
  useShellEventListener('holdings:focus', (payload) => {
    if (!portfolioId) return
    const code = encodeURIComponent(payload.stockCode)
    navigate(`/portfolio/${portfolioId}/holdings?expand=${code}`)
  })
}

/**
 * Shell 側裝配：`closing:openStock` → 跳到收盤分析並鎖定股票。
 * URL 契約：/portfolio/:id/daily?stock=<code>[&date=<YYYY-MM-DD>]
 */
export function useClosingOpenStockNavigation(portfolioId: string | undefined | null): void {
  const navigate = useNavigate()
  useShellEventListener('closing:openStock', (payload) => {
    if (!portfolioId) return
    const params = new URLSearchParams({ stock: payload.stockCode })
    if (payload.date) params.set('date', payload.date)
    navigate(`/portfolio/${portfolioId}/daily?${params.toString()}`)
  })
}

/**
 * Shell 側裝配：`research:prefill` → 跳到研究工作台並預填股票／主題。
 * URL 契約：/portfolio/:id/research?stock=<code>[&topic=<topic>]
 */
export function useResearchPrefillNavigation(portfolioId: string | undefined | null): void {
  const navigate = useNavigate()
  useShellEventListener('research:prefill', (payload) => {
    if (!portfolioId) return
    const params = new URLSearchParams({ stock: payload.stockCode })
    if (payload.topic) params.set('topic', payload.topic)
    navigate(`/portfolio/${portfolioId}/research?${params.toString()}`)
  })
}

export type { ShellEventBus, ShellEventHandler, ShellEventName, ShellEvents } from './eventBus'
