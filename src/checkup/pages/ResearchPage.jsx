import { createElement as h } from 'react'
import { ResearchPanel } from '../components/research/index.js'
import { useRouteResearchPage } from '../hooks/useRouteResearchPage.js'

export function ResearchPage() {
  const panelProps = useRouteResearchPage()

  return h(ResearchPanel, panelProps)
}
