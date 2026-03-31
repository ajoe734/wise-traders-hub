import { useEffect } from 'react'

export function useCanonicalLocalhostRedirect() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const { hostname, protocol, port, pathname, search, hash } = window.location
    if (hostname !== 'localhost') return

    if (sessionStorage.getItem('pf-redirect-done')) return

    sessionStorage.setItem('pf-redirect-done', '1')
    window.location.replace(
      `${protocol}//127.0.0.1${port ? `:${port}` : ''}${pathname}${search}${hash}`
    )
  }, [])
}
