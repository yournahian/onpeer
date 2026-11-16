import { createContext, useContext, type Context, type ReactNode } from 'react'
import { useAgent } from '@/agent/useAgent'

type AgentValue = ReturnType<typeof useAgent>

// Kept on globalThis so that a hot-reloaded copy of this module still talks to the provider that is already
// mounted. Two copies of a context object make "must be used inside Provider" errors that blank the whole app.
const KEY = '__onpeerAgentContext'
const store = globalThis as unknown as Record<string, Context<AgentValue | null> | undefined>
const Ctx: Context<AgentValue | null> = (store[KEY] ??= createContext<AgentValue | null>(null))

/** One conversation shared by the floating panel and the assistant page. */
export function AgentProvider({ route, children }: { route: string; children: ReactNode }) {
  const value = useAgent(route)
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentContext(): AgentValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAgentContext must be used inside AgentProvider')
  return v
}
