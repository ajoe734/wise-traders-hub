import { API_ENDPOINTS } from '../../constants.js'
import { getCheckupGateway } from '../../lib/gateway'
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
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'daily-analysis',
          portfolioId,
        }),
      })
      return payload;
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
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run-daily-analysis',
          portfolioId,
          ...data,
        }),
      })
      return payload;
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
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.ANALYZE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stress-test',
          portfolioId,
        }),
      })
      return payload;
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
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.BRAIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete-analysis',
          data: { id: reportId, date },
        }),
      })
      return payload;
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['analysis', 'history', portfolioId] })
    },
  })
}
