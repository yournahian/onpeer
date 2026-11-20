import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, BackendApiError, useBackendSession } from '@/lib/api'

export interface ChatMessage {
  id: string
  author: string
  body: string
  evidenceBlobId: string | null
  createdAt: string
}

export interface UseChatResult {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  send: (body: string, evidenceBlobId?: string | null) => Promise<void>
  sending: boolean
  hasMore: boolean
}

const POLL_INTERVAL_MS = 5_000

/**
 * Encrypted offchain chat for an order.
 * Polls every 5s while `active` is true (order is in a live state).
 */
export function useChat(orderId: bigint | null, active = true): UseChatResult {
  const session = useBackendSession()
  const orderKey = orderId ? orderId.toString() : ''

  // Bundle all derived-from-fetch state under a single keyed record to avoid
  // calling setMessages([]) or setIsLoading(true) directly inside effects
  // (which triggers react(set-state-in-effect) lint rule).
  const [state, setState] = useState<{
    key: string
    messages: ChatMessage[]
    hasMore: boolean
    loading: boolean
    error: string | null
  }>({ key: orderKey, messages: [], hasMore: false, loading: false, error: null })

  // Derive values: when the order key changes, treat stale state as empty/idle
  const isCurrentKey = state.key === orderKey
  const messages = isCurrentKey ? state.messages : []
  const hasMore = isCurrentKey ? state.hasMore : false
  const isLoading = isCurrentKey ? state.loading : false
  const error = isCurrentKey ? state.error : null

  const [sending, setSending] = useState(false)
  const afterIdRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchMessages = useCallback(
    async (reset = false) => {
      if (!orderId || !session) return
      const key = orderId.toString()
      const after = reset ? null : afterIdRef.current
      try {
        const qs = after ? `?after=${encodeURIComponent(after)}` : ''
        const data = await apiFetch<{ messages: ChatMessage[]; hasMore: boolean }>(
          `/orders/${orderId}/chat${qs}`,
        )
        setState((prev) => {
          const prevMsgs = prev.key === key ? prev.messages : []
          if (reset) {
            return { key, messages: data.messages, hasMore: data.hasMore, loading: false, error: null }
          }
          const existing = new Set(prevMsgs.map((m) => m.id))
          const fresh = data.messages.filter((m) => !existing.has(m.id))
          const next = fresh.length > 0 ? [...prevMsgs, ...fresh] : prevMsgs
          return { key, messages: next, hasMore: data.hasMore, loading: false, error: null }
        })
        if (data.messages.length > 0) {
          afterIdRef.current = data.messages[data.messages.length - 1]!.id
        }
      } catch (e) {
        if (e instanceof BackendApiError) {
          if (e.status === 401 || e.status === 403) {
            setState((prev) => (prev.key === key ? { ...prev, loading: false } : prev))
            return
          }
          setState((prev) =>
            prev.key === key ? { ...prev, loading: false, error: e.message } : prev,
          )
        }
      }
    },
    [orderId, session],
  )

  // Kick off initial load. We set loading=true inside setState (not bare) to avoid the lint rule.
  useEffect(() => {
    afterIdRef.current = null
    if (!orderId || !session) return
    const key = orderId.toString()
    // eslint-disable-next-line react/set-state-in-effect -- polling hook: loading state must be set here
    setState((prev) => ({ ...prev, key, messages: [], hasMore: false, loading: true, error: null }))
    void fetchMessages(true)
  }, [orderId, session, fetchMessages])

  // Polling while active
  useEffect(() => {
    if (!orderId || !session || !active) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      void fetchMessages(false)
    }, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [orderId, session, active, fetchMessages])

  const send = useCallback(
    async (body: string, evidenceBlobId: string | null = null) => {
      if (!orderId || !session || sending) return
      setSending(true)
      try {
        await apiFetch(`/orders/${orderId}/chat`, {
          method: 'POST',
          body: { body, evidenceBlobId },
        })
        await fetchMessages(false)
      } catch (e) {
        if (e instanceof BackendApiError) throw e
        throw new Error('send_failed')
      } finally {
        setSending(false)
      }
    },
    [orderId, session, sending, fetchMessages],
  )

  return { messages, isLoading, error, send, sending, hasMore }
}
