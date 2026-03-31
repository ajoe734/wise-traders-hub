import { buildPortfolioTabs } from '../lib/navigationTabs.js'
import { composeAppHeaderProps } from './useAppRuntimeComposer.js'

export function useAppRuntimeHeaderProps({
  theme,
  sync,
  pnl,
  portfolio,
  overview,
  notes,
  tabs,
  dialogs,
  constants,
}) {
  const portfolioTabs = buildPortfolioTabs({
    urgentCount: tabs.urgentCount,
    analyzing: tabs.analyzing,
    researching: tabs.researching,
  })

  return composeAppHeaderProps({
    theme,
    sync,
    pnl,
    portfolio,
    overview,
    notes,
    tabs: {
      ...tabs,
      portfolioTabs,
    },
    dialogs,
    constants,
  })
}
