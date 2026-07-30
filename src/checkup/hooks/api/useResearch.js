import { API_ENDPOINTS } from '../../constants.js'
import { getCheckupGateway } from '../../lib/gateway'
/**
 * Research API Hooks
 * 
 * TanStack Query hooks for research endpoints
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Run research mutation
 */
export function useRunResearch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ portfolioId, target, mode }) => {
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.RESEARCH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          portfolioId,
          target,
          mode,
        }),
      });
      return payload;
    },
    onSuccess: (data, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['research', 'history', portfolioId] });
    },
  });
}

/**
 * Fetch research history
 */
export function useResearchHistory(portfolioId, enabled = true) {
  return useQuery({
    queryKey: ['research', 'history', portfolioId],
    queryFn: async () => {
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.BRAIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-research-history' }),
      });
      const data = payload;
      return data.content || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

/**
 * Enrich research to dossier mutation
 */
export function useEnrichResearchToDossier() {
  return useMutation({
    mutationFn: async ({ portfolioId, code, researchResults }) => {
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.RESEARCH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'enrich-dossier',
          portfolioId,
          code,
          researchResults,
        }),
      });
      return payload;
    },
  });
}

/**
 * Refresh analyst reports mutation
 */
export function useRefreshAnalystReports() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ portfolioId, force = false }) => {
      const payload = await getCheckupGateway().http.json(API_ENDPOINTS.RESEARCH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'refresh-reports',
          portfolioId,
          force,
        }),
      });
      return payload;
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['analyst-reports', portfolioId] });
    },
  });
}
