import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import type { PublicClient } from 'viem'
import { CHAIN_ID } from '@/lib/p2p'
import { TOOL_LABELS, runTool, type Proposal } from '@/agent/tools'
import { extractTextCalls } from '@/agent/textCalls'

type ApiMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

type UiInput =
  | { kind: 'user' | 'assistant' | 'error' | 'tool'; text: string }
  | { kind: 'proposal'; proposal: Proposal }

export type UiItem = UiInput & { id: number }

export type Health =
  | { state: 'loading' }
  | { state: 'offline' }
  | { state: 'ready'; configured: boolean; active: string | null; providers: { id: string; label: string }[] }

async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { state: 'offline' }
    const data = (await res.json()) as { configured: boolean; active: string | null; providers: { id: string; label: string }[] }
    return { state: 'ready', ...data }
  } catch {
    return { state: 'offline' }
  }
}

const MAX_STEPS = 6

const ERROR_COPY: Record<string, string> = {
  not_configured: 'No AI provider key is set yet. Add one to .env and restart the assistant backend.',
  provider_auth: 'The AI provider rejected the key. Check the key in .env.',
  provider_rate_limit: 'The AI provider is rate limiting requests. Wait a moment and try again.',
  provider_error: 'The AI provider returned an error. Try again, or switch provider.',
  timeout: 'The AI provider took too long to answer. Try again.',
  rate_limited: 'Too many messages. Wait a minute and try again.',
}

/** Keep the request small without ever starting the history on an orphaned tool result. */
function trim(history: ApiMessage[]): ApiMessage[] {
  if (history.length <= 40) return history
  const start = history.length - 40
  const idx = history.findIndex((m, i) => i >= start && m.role === 'user')
  return idx === -1 ? history.slice(-1) : history.slice(idx)
}

export function useAgent(route: string) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient | undefined
  const [items, setItems] = useState<UiItem[]>([])
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<Health>({ state: 'loading' })
  const [provider, setProvider] = useState<string | undefined>()
  const history = useRef<ApiMessage[]>([])
  const nextId = useRef(1)

  const push = useCallback((item: UiInput) => {
    setItems((prev) => [...prev, { ...item, id: nextId.current++ }])
  }, [])

  const refreshHealth = useCallback(() => {
    void fetchHealth().then(setHealth)
  }, [])

  useEffect(() => {
    void fetchHealth().then(setHealth)
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || busy || !client) return
      setBusy(true)
      push({ kind: 'user', text: content })
      history.current = [...history.current, { role: 'user', content }]
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              messages: trim(history.current),
              provider,
              context: { address, route },
            }),
          })
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            message?: ApiMessage
          }
          if (!res.ok || !data.message) {
            push({ kind: 'error', text: ERROR_COPY[data.error ?? ''] ?? 'The assistant is unavailable right now.' })
            return
          }
          let assistant = data.message
          let calls = assistant.tool_calls ?? []
          if (calls.length === 0 && assistant.content) {
            const { calls: recovered, cleaned } = extractTextCalls(assistant.content)
            if (recovered.length > 0) {
              calls = recovered.map((c, i) => ({
                id: `text-${Date.now()}-${i}`,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              }))
              assistant = { ...assistant, content: cleaned, tool_calls: calls }
            }
          }
          history.current = [...history.current, assistant]
          if (assistant.content?.trim()) push({ kind: 'assistant', text: assistant.content.trim() })
          if (calls.length === 0) return

          const shown: Proposal[] = []
          for (const call of calls) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
            } catch {
              args = {}
            }
            push({ kind: 'tool', text: TOOL_LABELS[call.function.name] ?? 'Working' })
            const outcome = await runTool(call.function.name, args, { client, address })
            if (outcome.proposal) {
              push({ kind: 'proposal', proposal: outcome.proposal })
              shown.push(outcome.proposal)
            }
            history.current = [
              ...history.current,
              {
                role: 'tool',
                tool_call_id: call.id,
                name: call.function.name,
                content: JSON.stringify(outcome.result).slice(0, 6_000),
              },
            ]
          }

          // A review card is the answer. Say so ourselves instead of asking the model to narrate it.
          if (shown.length > 0) {
            const last = shown[shown.length - 1]
            const reply = last.inline
              ? `Ready. Finish it here in chat, or open the full page.${address ? '' : ' You will need to connect your wallet first.'}`
              : `Ready. Tap "${last.cta}" above to review and sign.${address ? '' : ' You will need to connect your wallet first.'}`
            history.current = [...history.current, { role: 'assistant', content: reply }]
            push({ kind: 'assistant', text: reply })
            return
          }
        }
        push({ kind: 'error', text: 'That took too many steps. Try asking in a simpler way.' })
      } catch {
        push({ kind: 'error', text: 'Could not reach the assistant backend. Is it running?' })
        refreshHealth()
      } finally {
        setBusy(false)
      }
    },
    [address, busy, client, provider, push, refreshHealth, route],
  )

  /** Lets an in-chat card tell the conversation what happened, so follow-up questions have context. */
  const report = useCallback(
    (text: string) => {
      history.current = [...history.current, { role: 'assistant', content: text }]
      push({ kind: 'assistant', text })
    },
    [push],
  )

  const reset = useCallback(() => {
    history.current = []
    setItems([])
  }, [])

  return { items, busy, health, provider, setProvider, send, reset, refreshHealth, report }
}
