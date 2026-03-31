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
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          portfolioId,
          target,
          mode,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
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
      const res = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-research-history' }),
      });
      if (!res.ok) throw new Error('Failed to fetch research history');
      const data = await res.json();
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
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'enrich-dossier',
          portfolioId,
          code,
          researchResults,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
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
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'refresh-reports',
          portfolioId,
          force,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_, { portfolioId }) => {
      queryClient.invalidateQueries({ queryKey: ['analyst-reports', portfolioId] });
    },
  });
}
