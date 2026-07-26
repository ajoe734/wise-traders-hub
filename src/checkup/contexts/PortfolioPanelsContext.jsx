/**
 * @deprecated Legacy 巨型 domain context — 未在 runtime 使用。
 * 現行每個模組用自己的 useRoute*Page hook 直接讀 store / usePortfolioRouteContext。
 * 詳見 docs/architecture/holdings-modules.md。
 */
import { createContext, useContext } from 'react'

const PortfolioPanelsDataContext = createContext(null)
const PortfolioPanelsActionsContext = createContext(null)

function createMissingContextError(name) {
  return new Error(`${name} is missing. Wrap AppPanels with <PortfolioPanelsProvider /> first.`)
}

export function PortfolioPanelsProvider({ data, actions, children }) {
  return (
    <PortfolioPanelsDataContext.Provider value={data}>
      <PortfolioPanelsActionsContext.Provider value={actions}>
        {children}
      </PortfolioPanelsActionsContext.Provider>
    </PortfolioPanelsDataContext.Provider>
  )
}

export function usePortfolioPanelsData() {
  const value = useContext(PortfolioPanelsDataContext)
  if (!value) throw createMissingContextError('PortfolioPanelsDataContext')
  return value
}

export function usePortfolioPanelsActions() {
  const value = useContext(PortfolioPanelsActionsContext)
  if (!value) throw createMissingContextError('PortfolioPanelsActionsContext')
  return value
}

