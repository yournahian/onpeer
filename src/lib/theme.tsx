import { createContext, useCallback, type Context, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePref = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const KEY = 'onpeer-theme'

type ThemeCtx = {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref: (p: ThemePref) => void
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const on = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const resolved: ResolvedTheme = pref === 'system' ? system : pref

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#06030d' : '#f8f4ff')
  }, [resolved])

  const setPref = useCallback((p: ThemePref) => {
    const root = document.documentElement
    root.classList.add('theme-anim')
    window.setTimeout(() => root.classList.remove('theme-anim'), 450)
    try {
      localStorage.setItem(KEY, p)
    } catch {
      /* storage unavailable */
    }
    setPrefState(p)
  }, [])

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme must be used inside ThemeProvider')
  return v
}
