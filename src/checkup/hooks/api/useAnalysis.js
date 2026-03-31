/**
 * Analysis API Hooks
 *
 * TanStack Query hooks for analysis endpoints
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Fetch daily analysis report
 */
export function useDailyAnalysis(portfolioId, enabled = true) {
  return useQuery({
    queryKey: ['analysis', 'daily', portfolioId],
    queryFn: async () => {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'daily-analysis',
          portfolioId,
        }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      return res.json()
    },
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  })
}

/**
 * Run daily analysis mutation
 */
export function useRunDailyAnalysis() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ portfolioId, data }) => {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-daily-analysis',
          portfolioId,
          ...data,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data, { portfolioId }) => {
      queryClient.setQueryData(['analysis', 'daily', portfolioId], data)
      queryClient.invalidateQueries({ queryKey: ['analysis', 'daily', portfolioId] })
    },
  })
}

/**
 * Run stress test mutation
 */
export function useRunStressTest() {
  return useMutation({
    mutationFn: async ({ portfolioId }) => {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stress-test',
          portfolioId,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })
}

/**
 * Delete analysis report mutation
 */
export function useDeleteAnalysis() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ portfolioId: _portfolioId, reportId, date }) => {
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete-analysis',
          data: { id: reportId, date },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['analysis', 'history', portfolioId] })
    },
  })
}
