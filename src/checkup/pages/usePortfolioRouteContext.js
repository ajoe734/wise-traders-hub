import { useOutletContext } from 'react-router-dom'

export function usePortfolioRouteContext() {
  return useOutletContext() || {}
}
