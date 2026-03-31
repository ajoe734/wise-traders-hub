import { useMemo } from 'react'
import { buildMorningNote } from '../lib/morningNoteBuilder.js'

export function useMorningNoteRuntime({ holdings, theses, newsEvents, watchlist }) {
  return useMemo(
    () =>
      buildMorningNote({
        holdings: holdings || [],
        theses,
        events: newsEvents || [],
        watchlist: watchlist || [],
        institutional: null,
        announcements: [],
      }),
    [holdings, theses, newsEvents, watchlist]
  )
}
