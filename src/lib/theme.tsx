import { createContext, useCallback, type Context, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePref = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const KEY = 'onpeer-theme'
const HELIX_KEY = 'onpeer-helix-motion'
const HELIX_VISIBLE_KEY = 'onpeer-helix-visible'

type ThemeCtx = {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref: (p: ThemePref) => void
  helixMotion: boolean
  setHelixMotion: (v: boolean) => void
  helixVisible: boolean
  setHelixVisible: (v: boolean) => void
  helixBlurred: boolean
  setHelixBlurred: (v: boolean) => void
}

// Kept on globalThis so a hot-reloaded copy of this module still finds the provider that is already mounted.
const CTX_KEY = '__onpeerThemeContext'
const store = globalThis as unknown as Record<string, Context<ThemeCtx | null> | undefined>
const Ctx: Context<ThemeCtx | null> = (store[CTX_KEY] ??= createContext<ThemeCtx | null>(null))

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

const systemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'

const readHelix = (): boolean => {
  try {
    return localStorage.getItem(HELIX_KEY) !== 'off'
  } catch {
    return true
  }
}

const readHelixVisible = (): boolean => {
  try {
    return localStorage.getItem(HELIX_VISIBLE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)
  const [helixMotion, setHelixState] = useState<boolean>(readHelix)
  const [helixVisible, setHelixVisibleState] = useState<boolean>(readHelixVisible)
  const [helixBlurred, setHelixBlurred] = useState<boolean>(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const on = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const resolved: ResolvedTheme = pref === 'system' ? system : pref

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff')
  }, [resolved])

  useEffect(() => {
    document.documentElement.setAttribute('data-helix', helixVisible && helixMotion ? 'on' : 'off')
  }, [helixMotion, helixVisible])

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p)
    } catch {
      /* storage unavailable */
    }
    setPrefState(p)
  }, [])

  const setHelixMotion = useCallback((v: boolean) => {
    try {
      localStorage.setItem(HELIX_KEY, v ? 'on' : 'off')
    } catch {
      /* storage unavailable */
    }
    setHelixState(v)
  }, [])

  const setHelixVisible = useCallback((v: boolean) => {
    try {
      localStorage.setItem(HELIX_VISIBLE_KEY, v ? 'on' : 'off')
    } catch {
      /* storage unavailable */
    }
    setHelixVisibleState(v)
  }, [])

  const value = useMemo(
    () => ({
      pref,
      resolved,
      setPref,
      helixMotion,
      setHelixMotion,
      helixVisible,
      setHelixVisible,
      helixBlurred,
      setHelixBlurred,
    }),
    [pref, resolved, setPref, helixMotion, setHelixMotion, helixVisible, setHelixVisible, helixBlurred],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme must be used inside ThemeProvider')
  return v
}
