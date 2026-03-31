import { useMemo, useState } from 'react'
import { useBrainStore } from '../stores/brainStore.js'
import { usePortfolioRouteContext } from '../pages/usePortfolioRouteContext.js'

export function useRouteEventsPage() {
  const { newsEvents = [] } = usePortfolioRouteContext()
  const relayPlanExpanded = useBrainStore((state) => state.relayPlanExpanded)
  const setRelayPlanExpanded = useBrainStore((state) => state.setRelayPlanExpanded)
  const [filterType, setFilterType] = useState('全部')

  return useMemo(() => {
    const filteredEvents = newsEvents.filter((event) =>
      filterType === '全部' ? true : event.type === filterType
    )

    return {
      showRelayPlan: true,
      relayPlanExpanded,
      setRelayPlanExpanded,
      filterType,
      setFilterType,
      filteredEvents,
    }
  }, [filterType, newsEvents, relayPlanExpanded, setRelayPlanExpanded])
}
