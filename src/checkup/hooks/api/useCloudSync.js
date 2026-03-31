/**
 * Cloud Sync API Hooks
 *
 * TanStack Query hooks for cloud sync endpoints
 */

import { useQuery, useMutation } from '@tanstack/react-query'

/**
 * Sync holdings from cloud
 */
export function useSyncHoldingsFromCloud(portfolioId, enabled = true) {
  return useQuery({
    queryKey: ['cloud', 'holdings', portfolioId],
    queryFn: async () => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-holdings' }),
      })
      if (!res.ok) throw new Error('Failed to sync holdings')
      const data = await res.json()
      return data.content || []
    },
    enabled: enabled && portfolioId === 'me', // Only for owner portfolio
    staleTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  })
}

/**
 * Save holdings to cloud mutation
 */
export function useSaveHoldingsToCloud() {
  return useMutation({
    mutationFn: async ({ portfolioId: _portfolioId, holdings }) => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-holdings',
          data: { holdings },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

/**
 * Sync brain from cloud
 */
export function useSyncBrainFromCloud(enabled = true) {
  return useQuery({
    queryKey: ['cloud', 'brain'],
    queryFn: async () => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-brain' }),
      })
      if (!res.ok) throw new Error('Failed to sync brain')
      const data = await res.json()
      return data.content
    },
    enabled,
    staleTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  })
}

/**
 * Save brain to cloud mutation
 */
export function useSaveBrainToCloud() {
  return useMutation({
    mutationFn: async ({ brainData }) => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-brain',
          data: brainData,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

/**
 * Sync analysis history from cloud
 */
export function useSyncAnalysisFromCloud(portfolioId, enabled = true) {
  return useQuery({
    queryKey: ['cloud', 'analysis', portfolioId],
    queryFn: async () => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-analysis-history' }),
      })
      if (!res.ok) throw new Error('Failed to sync analysis')
      const data = await res.json()
      return data.content || []
    },
    enabled: enabled && portfolioId === 'me',
    staleTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  })
}

/**
 * Sync research history from cloud
 */
export function useSyncResearchFromCloud(enabled = true) {
  return useQuery({
    queryKey: ['cloud', 'research'],
    queryFn: async () => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-research-history' }),
      })
      if (!res.ok) throw new Error('Failed to sync research')
      const data = await res.json()
      return data.content || []
    },
    enabled,
    staleTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  })
}
