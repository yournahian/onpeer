import { useEffect, useRef } from 'react'
import { navigate, type Route } from '@/lib/router'
import type { ResolvedTheme } from '@/lib/theme'

export interface TelegramWebAppUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  allows_write_to_pm?: boolean
}

export interface TelegramBackButton {
  isVisible: boolean
  show: () => void
  hide: () => void
  onClick: (cb: () => void) => void
  offClick: (cb: () => void) => void
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  selectionChanged: () => void
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe?: {
    user?: TelegramWebAppUser
    start_param?: string
    auth_date?: number
  }
  version?: string
  platform?: string
  colorScheme?: 'light' | 'dark'
  isExpanded?: boolean
  ready: () => void
  expand: () => void
  close: () => void
  disableVerticalSwipes?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void
  openTelegramLink?: (url: string) => void
  BackButton?: TelegramBackButton
  HapticFeedback?: TelegramHapticFeedback
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp
    }
  }
}

/** Returns the active `Telegram.WebApp` object ONLY when running inside a real Telegram Mini App session. */
export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  const tg = window.Telegram?.WebApp
  if (!tg || typeof tg.initData !== 'string' || tg.initData.length === 0) return null
  return tg
}

export function isTelegramMiniApp(): boolean {
  return getTelegramWebApp() !== null
}

export function getTelegramInitData(): string {
  return getTelegramWebApp()?.initData ?? ''
}

export function getTelegramMiniAppUser(): { id: number; username: string | null; firstName: string | null } | null {
  const u = getTelegramWebApp()?.initDataUnsafe?.user
  if (!u || typeof u.id !== 'number') return null
  return {
    id: u.id,
    username: u.username ?? null,
    firstName: u.first_name ?? null,
  }
}

/** Opens a `https://t.me/...` link natively in Telegram or in a new browser tab on web. */
export function openTelegramUrl(url: string): void {
  const tg = getTelegramWebApp()
  if (tg?.openTelegramLink && /^https:\/\/t\.me\//i.test(url)) {
    tg.openTelegramLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Opens an external HTTPS URL safely from either Telegram Mini App or standard browser. */
export function openExternalUrl(url: string): void {
  const tg = getTelegramWebApp()
  if (tg?.openLink) {
    tg.openLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function triggerTelegramHaptic(kind: 'light' | 'success' | 'warning' = 'light'): void {
  const hf = getTelegramWebApp()?.HapticFeedback
  if (!hf) return
  try {
    if (kind === 'light') hf.impactOccurred('light')
    else hf.notificationOccurred(kind)
  } catch {
    /* ignore unsupported SDK versions */
  }
}

/**
 * Synchronizes the React app lifecycle with Telegram Mini App host chrome:
 * - Expands viewport & disables accidental swipe-to-close when scrolling P2P orderbooks/chats
 * - Syncs header & background colors with OnPeer's solid dark (`#000000`) and light (`#ffffff`) themes
 * - Routes `tgWebAppStartParam` (`order_42`, `swap`, `bridge`) directly to the right view on launch
 * - Binds Telegram's native top-left BackButton on sub-pages or open order rooms
 */
export function useTelegramMiniAppBridge(route: Route, search: string, resolvedTheme: ResolvedTheme): void {
  const handledLaunchRef = useRef(false)

  useEffect(() => {
    const tg = getTelegramWebApp()
    if (!tg) return

    try {
      tg.ready()
      tg.expand()
      tg.disableVerticalSwipes?.()
    } catch {
      /* ignore older Telegram clients */
    }

    if (!handledLaunchRef.current) {
      handledLaunchRef.current = true
      const startParam =
        tg.initDataUnsafe?.start_param ||
        new URLSearchParams(window.location.search).get('tgWebAppStartParam') ||
        ''

      if (/^order_\d+$/.test(startParam)) {
        const orderId = startParam.slice('order_'.length)
        navigate(`/p2p?order=${orderId}`)
      } else if (startParam === 'swap') {
        navigate('/swap')
      } else if (startParam === 'bridge') {
        navigate('/bridge')
      } else if (window.location.pathname === '/' && !window.location.search.includes('order=')) {
        // Inside Telegram Mini App, jump straight into the P2P trading terminal instead of marketing landing
        navigate('/p2p')
      }
    }
  }, [])

  useEffect(() => {
    const tg = getTelegramWebApp()
    if (!tg) return
    const hex = resolvedTheme === 'dark' ? '#000000' : '#ffffff'
    try {
      tg.setHeaderColor?.(hex)
      tg.setBackgroundColor?.(hex)
    } catch {
      /* ignore older Telegram clients */
    }
  }, [resolvedTheme])

  useEffect(() => {
    const tg = getTelegramWebApp()
    const backBtn = tg?.BackButton
    if (!backBtn) return

    const hasOrderParam = new URLSearchParams(search).has('order')
    const showBack = hasOrderParam || (route !== 'p2p' && route !== 'home')

    const onBack = () => {
      navigate('/p2p')
    }

    try {
      if (showBack) {
        backBtn.onClick(onBack)
        backBtn.show()
      } else {
        backBtn.hide()
      }
    } catch {
      /* ignore */
    }

    return () => {
      try {
        backBtn.offClick(onBack)
      } catch {
        /* ignore */
      }
    }
  }, [route, search])
}
