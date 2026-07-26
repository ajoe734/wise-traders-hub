/**
 * @deprecated Legacy tab renderer — 未在 runtime 路由中使用。
 * 現行架構每個 tab 各自為 route page（見 docs/architecture/holdings-modules.md）。
 * 請勿新增 panel 到 panelRegistry；改在對應 pages/<Name>Page.jsx。
 */
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { HoldingsPanel, HoldingsTable } from './holdings/index.js'

import { EventsPanel } from './events/index.js'
import { DailyReportPanel } from './reports/index.js'
import { ResearchPanel } from './research/index.js'
import { TradePanel } from './trade/index.js'
import { LogPanel } from './log/index.js'
import { NewsAnalysisPanel } from './news/index.js'
import { OverviewPanel } from './overview/index.js'
import { usePortfolioPanelsActions, usePortfolioPanelsData } from '../contexts/PortfolioPanelsContext.jsx'

export default function AppPanels({
  viewMode,
  overviewViewMode,
  tab,
  errorBoundaryCopy,
}) {
  const data = usePortfolioPanelsData()
  const actions = usePortfolioPanelsActions()
  const activePanelKey = viewMode === overviewViewMode ? 'overview' : tab

  const overviewProps = { ...data.overview, ...actions.overview }
  const holdingsProps = { ...data.holdings, ...actions.holdings }
  const holdingsTableProps = { ...data.holdingsTable, ...actions.holdingsTable }
  
  const eventsProps = { ...data.events, ...actions.events }
  const dailyProps = { ...data.daily, ...actions.daily }
  const researchProps = { ...data.research, ...actions.research }
  const tradeProps = { ...data.trade, ...actions.trade }
  const logProps = { ...data.log, ...actions.log }
  const newsProps = { ...data.news, ...actions.news }

  const panelRegistry = {
    overview: {
      scope: 'overview-panel',
      title: errorBoundaryCopy.overview.title,
      content: <OverviewPanel {...overviewProps} />,
    },
    holdings: {
      scope: 'holdings-panel',
      title: errorBoundaryCopy.holdings.title,
      content: (
        <HoldingsPanel {...holdingsProps}>
          <HoldingsTable {...holdingsTableProps} />
        </HoldingsPanel>
      ),
    },
    events: {
      scope: 'events-panel',
      title: errorBoundaryCopy.events.title,
      content: <EventsPanel {...eventsProps} />,
    },
    daily: {
      scope: 'daily-report-panel',
      title: errorBoundaryCopy.daily.title,
      content: <DailyReportPanel {...dailyProps} />,
    },
    research: {
      scope: 'research-panel',
      title: errorBoundaryCopy.research.title,
      content: <ResearchPanel {...researchProps} />,
    },
    trade: {
      scope: 'trade-panel',
      title: errorBoundaryCopy.trade.title,
      content: <TradePanel {...tradeProps} />,
    },
    log: {
      scope: 'log-panel',
      title: errorBoundaryCopy.log.title,
      content: <LogPanel {...logProps} />,
    },
    news: {
      scope: 'news-analysis-panel',
      title: errorBoundaryCopy.news.title,
      content: <NewsAnalysisPanel {...newsProps} />,
    },
  }

  const activePanel = panelRegistry[activePanelKey]
  if (!activePanel) return null

  return (
    <ErrorBoundary scope={activePanel.scope} title={activePanel.title}>
      {activePanel.content}
    </ErrorBoundary>
  )
}
