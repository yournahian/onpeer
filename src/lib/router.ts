import { useSyncExternalStore } from 'react'

export type Route =
  | 'home'
  | 'p2p'
  | 'swap'
  | 'bridge'
  | 'buy'
  | 'admin'
  | 'assistant'
  | 'docs'
  | 'brand-kit'
  | 'privacy'

export const LANDING_URL = 'https://onpeer.xyz'
export const APP_URL = 'https://app.onpeer.xyz'
export const DOCS_URL = 'https://docs.onpeer.xyz'

export function isAppSubdomain(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.startsWith('app.')
}

export function isDocsSubdomain(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.startsWith('docs.')
}

export function isLandingDomain(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'onpeer.xyz' || h === 'www.onpeer.xyz'
}

const NAV_EVENT = 'app:navigate'

function currentRoute(): Route {
  if (isDocsSubdomain()) return 'docs'
  const { pathname, search } = window.location
  if (pathname.startsWith('/p2p')) return 'p2p'
  if (pathname.startsWith('/swap')) return 'swap'
  if (pathname.startsWith('/bridge')) return 'bridge'
  if (pathname.startsWith('/buy')) return 'buy'
  if (pathname.startsWith('/cashout')) return 'p2p'
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname.startsWith('/assistant')) return 'assistant'
  if (pathname.startsWith('/docs')) return 'docs'
  if (pathname.startsWith('/brand-kit')) return 'brand-kit'
  if (pathname.startsWith('/privacy')) return 'privacy'
  // Older order links were shared as /?order=ID
  if (new URLSearchParams(search).has('order')) return 'p2p'
  if (isAppSubdomain()) return 'p2p'
  return 'home'
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAV_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAV_EVENT, onChange)
  }
}

export function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAV_EVENT))
  window.scrollTo(0, 0)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, () => 'home')
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/')
}

function subscribeSearch(onChange: () => void) {
  return subscribe(onChange)
}

/** The current query string (e.g. "?order=3"), reactive to in-app navigation. */
export function useSearch(): string {
  return useSyncExternalStore(subscribeSearch, () => window.location.search, () => '')
}

/** Update the query string in place (no new history entry) and notify subscribers. */
export function replaceQuery(update: (params: URLSearchParams) => void) {
  const url = new URL(window.location.href)
  update(url.searchParams)
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new Event(NAV_EVENT))
}
