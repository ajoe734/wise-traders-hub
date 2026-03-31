import { createElement as h } from 'react'
import { NewsAnalysisPanel } from '../components/news/index.js'
import { useRouteNewsPage } from '../hooks/useRouteNewsPage.js'

export function NewsPage() {
  const panelProps = useRouteNewsPage()

  return h(NewsAnalysisPanel, panelProps)
}
