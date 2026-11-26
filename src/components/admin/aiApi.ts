import { useSyncExternalStore } from 'react'

export type ProviderId = 'openrouter' | 'groq' | 'gemini' | 'custom'

export type ProviderStatus = {
  id: ProviderId
  label: string
  model: string | null
  baseUrl: string | null
  hasKey: boolean
  source: 'admin' | 'env' | 'none'
  configured: boolean
  hasSavedSettings: boolean
}

export type AiStatus = { active: ProviderId | null; providers: ProviderStatus[] }

export type TestResult = { ok: boolean; ms?: number; reason?: string; status?: number; detail?: string }

const ERROR_COPY: Record<string, string> = {
  not_admin: 'This wallet is not the contract owner or arbiter.',
  nonce_expired: 'The sign-in request expired. Try again.',
  bad_signature: 'The signature could not be verified.',
  unauthorized: 'Your admin session ended. Unlock again.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  bad_base_url: 'The base URL must start with https:// (http:// only for localhost).',
  bad_provider: 'Unknown provider.',
  rpc_error: 'Could not reach the Arc RPC to verify your admin wallet. Try again.',
  service_unavailable: 'The backend database or secret config is temporarily unavailable.',
  server_error: 'The assistant backend hit an error.',
}

// The session token lives in memory only: closing or reloading the tab signs you out.
let token: string | null = null
let expiresAt = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function setSession(t: string, seconds: number) {
  token = t
  expiresAt = Date.now() + seconds * 1000
  emit()
}
export function clearSession() {
  token = null
  expiresAt = 0
  emit()
}
const unlocked = () => !!token && Date.now() < expiresAt

export function useUnlocked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    unlocked,
    () => false,
  )
}

export class AdminApiError extends Error {
  constructor(public code: string) {
    super(ERROR_COPY[code] ?? (code === 'offline' ? 'The assistant backend is not running. Start it with bun run server.' : 'Something went wrong.'))
  }
}

export async function adminFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new AdminApiError('offline')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    if (data.error === 'unauthorized') clearSession()
    throw new AdminApiError(data.error ?? 'server_error')
  }
  return data as T
}

export const TEST_COPY: Record<string, string> = {
  not_configured: 'Add a key, model and base URL first.',
  auth: 'The provider rejected the key.',
  model_or_url: 'The URL or model name was not found.',
  rate_limit: 'The provider is rate limiting. Try again shortly.',
  provider_error: 'The provider returned an error.',
  timeout: 'No answer within 20 seconds.',
  unreachable: 'Could not reach the provider.',
}
