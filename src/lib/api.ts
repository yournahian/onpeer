import { useSyncExternalStore } from 'react'
import { isTelegramMiniApp, openExternalUrl } from '@/lib/telegram'

export interface StoredBackendSession {
  token: string
  wallet: `0x${string}`
  expiresAtMs: number
}

const STORAGE_KEY = 'onpeer:p2p:session'

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Please sign in with your wallet first.',
  forbidden: 'This wallet does not have permission for that resource.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  consent_required: 'Accept the privacy and KYC notice before saving.',
  invalid_display_name: 'Display name must be 1–48 plain characters.',
  invalid_country: 'Choose a valid country code.',
  invalid_email: 'Enter a valid email address.',
  email_locked: 'Your verified email cannot be changed here. To change your email, please contact support.',
  invalid_or_expired_token: 'This verification link is invalid or has expired.',
  no_email_set: 'Save an email address first.',
  nonce_expired: 'Sign-in challenge expired. Please try again.',
  bad_signature: 'Wallet signature verification failed.',
  sandbox_disabled: 'Sandbox scenarios are disabled in live KYC mode.',
  invalid_sandbox_scenario: 'Invalid sandbox scenario selected.',
  kyc_not_configured: 'KYC service is not configured on this server yet.',
  kyc_provider_error: 'Could not start verification session with Didit. Please try again.',
  invalid_vault_payload: 'Enter both account holder name and valid payment details.',
  transfer_id_required: 'Transfer ID is required after the payment timer expires.',
  invalid_order_status: 'Order is no longer in the pending payment state.',
  message_empty: 'Message cannot be empty.',
  message_too_long: 'Message exceeds the 4 KB limit.',
  dispute_already_filed: 'You have already submitted a dispute statement for this order.',
  dispute_not_eligible: 'This order is not in a disputable state.',
  open_orders_remain: 'Close or complete all open P2P orders before deleting your account.',
  active_ads_remain: 'Close all active P2P ads before deleting your account.',
  invalid_file_signature: 'File content does not match the allowed image or PDF type.',
  invalid_reason_code: 'Select a valid dispute reason.',
  statement_too_long: 'Statement must be under 8 KB.',
  onramp_not_configured: 'Sandbox checkout is not configured on this server right now.',
  onramp_env_mismatch: 'Sandbox checkout is temporarily unavailable due to a server configuration mismatch.',
  onramp_sandbox_only: 'OnPeer checkout is currently restricted to sandbox mode.',
  onramp_invalid_referrer_domain: 'Sandbox checkout is temporarily unavailable due to a server domain configuration issue.',
  onramp_provider_error: 'Could not start a sandbox checkout session right now. Please try again.',
  telegram_not_configured: 'Telegram Bot is not configured on this server yet (set TELEGRAM_BOT_TOKEN & TELEGRAM_BOT_USERNAME).',
  invalid_telegram_init_data: 'Could not verify Telegram Mini App session. Please reopen from Telegram and try again.',
  telegram_not_linked: 'Connect your Telegram account first.',
  telegram_send_failed: 'Telegram could not deliver the message. Make sure you pressed Start in the bot chat.',
  service_unavailable: 'Backend service is temporarily unavailable.',
  offline: 'Could not reach the OnPeer backend (/api). Make sure wrangler dev is running.',
}

export class BackendApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public detail?: string,
  ) {
    const base = ERROR_MESSAGES[code] ?? 'Request failed. Please try again.'
    super(detail ? `${base} (${detail})` : base)
  }
}

let cachedSession: StoredBackendSession | null = null
let hydrated = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

function hydrateSession(): StoredBackendSession | null {
  if (hydrated) return cachedSession
  hydrated = true
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredBackendSession>
    if (
      typeof parsed.token === 'string' &&
      /^[0-9a-f]{64}$/.test(parsed.token) &&
      typeof parsed.wallet === 'string' &&
      /^0x[0-9a-f]{40}$/.test(parsed.wallet) &&
      typeof parsed.expiresAtMs === 'number' &&
      parsed.expiresAtMs > Date.now()
    ) {
      cachedSession = {
        token: parsed.token,
        wallet: parsed.wallet as `0x${string}`,
        expiresAtMs: parsed.expiresAtMs,
      }
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore storage errors */
  }
  return cachedSession
}

export function getBackendSession(): StoredBackendSession | null {
  const s = hydrateSession()
  if (s && s.expiresAtMs <= Date.now()) {
    clearBackendSession()
    return null
  }
  return s
}

export function setBackendSession(token: string, wallet: string, expiresInSeconds: number) {
  const next: StoredBackendSession = {
    token,
    wallet: wallet.toLowerCase() as `0x${string}`,
    expiresAtMs: Date.now() + expiresInSeconds * 1000,
  }
  cachedSession = next
  hydrated = true
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  notify()
}

export function clearBackendSession() {
  if (!cachedSession && hydrated) return
  cachedSession = null
  hydrated = true
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  notify()
}

export function useBackendSession(): StoredBackendSession | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getBackendSession,
    () => null,
  )
}

export async function apiFetch<T>(
  path: string,
  init?: {
    method?: string
    body?: unknown
    rawBody?: BodyInit
    headers?: Record<string, string>
    auth?: boolean
  },
): Promise<T> {
  const session = init?.auth === false ? null : getBackendSession()
  const headers: Record<string, string> = {
    ...(init?.headers ?? {}),
  }
  if (init?.body !== undefined && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  if (session) {
    headers.authorization = `Bearer ${session.token}`
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.rawBody ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    })
  } catch {
    throw new BackendApiError('offline', 0)
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
  if (!res.ok) {
    if (res.status === 401 && init?.auth !== false) {
      clearBackendSession()
    }
    throw new BackendApiError(data.error ?? 'server_error', res.status, typeof data.detail === 'string' ? data.detail : undefined)
  }
  return data as T
}

export async function signInWithWallet(
  address: string,
  signMessageAsync: (args: { message: string }) => Promise<string>,
): Promise<StoredBackendSession> {
  const normalized = address.toLowerCase()
  const challenge = await apiFetch<{ nonce: string; message: string }>('/auth/nonce', {
    method: 'POST',
    body: { address: normalized },
    auth: false,
  })
  let nudgeTimer: number | null = null
  if (isTelegramMiniApp()) {
    nudgeTimer = window.setTimeout(() => {
      try {
        const id = window.sessionStorage.getItem('onpeer:tg:wallet_id')
        const map: Record<string, string> = {
          metamask: 'https://metamask.app.link/wc',
          trust: 'https://link.trustwallet.com/wc',
          coinbase: 'https://go.cb-w.com/wc',
          rainbow: 'https://rnbwapp.com/wc',
          zerion: 'https://wallet.zerion.io/wc',
        }
        if (id && map[id]) openExternalUrl(map[id])
      } catch {
        /* ignore */
      }
    }, 400)
  }
  let signature: string
  try {
    signature = await signMessageAsync({ message: challenge.message })
  } finally {
    if (nudgeTimer !== null) window.clearTimeout(nudgeTimer)
  }
  const login = await apiFetch<{ token: string; wallet: string; expiresInSeconds: number }>('/auth/login', {
    method: 'POST',
    body: { address: normalized, signature, nonce: challenge.nonce },
    auth: false,
  })
  setBackendSession(login.token, login.wallet, login.expiresInSeconds)
  return getBackendSession()!
}

export async function signOutFromBackend(): Promise<void> {
  try {
    if (getBackendSession()) {
      await apiFetch('/auth/logout', { method: 'POST' })
    }
  } catch {
    /* clear locally regardless */
  } finally {
    clearBackendSession()
  }
}
