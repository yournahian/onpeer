import { useEffect, useMemo, useState } from 'react'
import { apiFetch, useBackendSession } from '@/lib/api'

const HEARTBEAT_MS = 45_000
const POLL_PRESENCE_MS = 30_000

/**
 * Sends a lightweight presence heartbeat whenever the signed-in user has
 * any OnPeer page open and visible in their browser.
 */
export function usePresenceHeartbeat() {
  const session = useBackendSession()

  useEffect(() => {
    if (!session) return

    const ping = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void apiFetch('/presence/ping', { method: 'POST' }).catch(() => undefined)
    }

    ping()
    const timer = window.setInterval(ping, HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', ping)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', ping)
    }
  }, [session])
}

/**
 * Polls real website-wide online presence for a list of wallet addresses.
 * A wallet is online if it sent a browser heartbeat within the last 90 seconds.
 */
export function useOnlineStatus(wallets: string[]): Map<string, boolean> {
  const key = useMemo(() => {
    const uniq = Array.from(new Set(wallets.map((w) => w.toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w))))
    uniq.sort()
    return uniq.slice(0, 50).join(',')
  }, [wallets])

  const [onlineMap, setOnlineMap] = useState<Map<string, boolean>>(() => new Map())

  useEffect(() => {
    if (!key) return
    let cancelled = false

    const load = () => {
      fetch(`/api/presence?wallets=${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { online?: Record<string, boolean> } | null) => {
          if (cancelled || !data?.online) return
          const next = new Map<string, boolean>()
          for (const [w, ok] of Object.entries(data.online)) {
            next.set(w.toLowerCase(), Boolean(ok))
          }
          setOnlineMap(next)
        })
        .catch(() => undefined)
    }

    load()
    const timer = window.setInterval(load, POLL_PRESENCE_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [key])

  return key ? onlineMap : new Map()
}
