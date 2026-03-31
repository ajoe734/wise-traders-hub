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

