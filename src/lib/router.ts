import { useSyncExternalStore } from 'react'

export type Route = 'home' | 'p2p' | 'swap' | 'bridge' | 'admin' | 'assistant'

const NAV_EVENT = 'app:navigate'

function currentRoute(): Route {
  const { pathname, search } = window.location
  if (pathname.startsWith('/p2p')) return 'p2p'
  if (pathname.startsWith('/swap')) return 'swap'
  if (pathname.startsWith('/bridge')) return 'bridge'
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname.startsWith('/assistant')) return 'assistant'
  // Older order links were shared as /?order=ID
  if (new URLSearchParams(search).has('order')) return 'p2p'
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
