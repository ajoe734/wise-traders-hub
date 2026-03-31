import { createElement as h } from 'react'
import { DailyReportPanel } from '../components/reports/index.js'
import { useRouteDailyPage } from '../hooks/useRouteDailyPage.js'

export function DailyPage() {
  const panelProps = useRouteDailyPage()

  return h(DailyReportPanel, panelProps)
}
