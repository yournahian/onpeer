import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import {
  apiFetch,
  clearBackendSession,
  signInWithWallet,
  signOutFromBackend,
  useBackendSession,
} from '@/lib/api'

export interface P2pAccountProfile {
  exists: boolean
  wallet: `0x${string}`
  displayName: string | null
  country: string | null
  hasEmail: boolean
  emailMasked: string | null
  emailVerified: boolean
  emailOptIn: boolean
  kycStatus: 'none' | 'pending' | 'in_review' | 'approved' | 'declined' | 'expired' | 'revoked'
  kycLevel: number
  kycExpiresAt: string | null
  consentAt: string | null
  createdAt: string | null
  diditMode: 'sandbox' | 'live'
  verificationEmail?: { queued: boolean; reason?: string }
}

export interface UpsertAccountInput {
  displayName?: string | null
  country?: string | null
  email?: string | null
  emailOptIn?: boolean
  consent?: boolean
}

export interface SavedPaymentMethod {
  id: string
  methodBit: number
  methodName: string
  holderName: string
  accountNumber: string
  bankOrBranch: string
  branchName?: string
  routingNumber?: string
  notes: string
  updatedAt: string
}

export interface ParsedPaymentEntry {
  methodName: string
  holderName: string
  accountNumber: string
  bankOrType: string
  branchName: string
  routingNumber: string
  remarks: string
  rawLine: string
}

const cleanPipe = (v: string) => v.replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim()

export function formatSavedMethodLine(m: SavedPaymentMethod, includeHolder: boolean): string {
  const parts: string[] = [cleanPipe(m.methodName)]
  if (includeHolder && m.holderName.trim()) {
    parts.push(`Name: ${cleanPipe(m.holderName)}`)
  }
  parts.push(`Account: ${cleanPipe(m.accountNumber)}`)
  if (m.bankOrBranch.trim()) {
    const label = m.methodName === 'Bank transfer' ? 'Bank' : 'Type'
    parts.push(`${label}: ${cleanPipe(m.bankOrBranch)}`)
  }
  if (m.branchName?.trim()) {
    parts.push(`Branch: ${cleanPipe(m.branchName)}`)
  }
  if (m.routingNumber?.trim()) {
    parts.push(`Routing: ${cleanPipe(m.routingNumber)}`)
  }
  if (m.notes.trim()) {
    parts.push(`Remarks: ${cleanPipe(m.notes)}`)
  }
  return parts.join(' | ')
}

export function formatSavedMethodsBlock(methods: SavedPaymentMethod[], includeHolder: boolean): string {
  return methods.map((m) => formatSavedMethodLine(m, includeHolder)).join('\n')
}

/** Parse structured (`Method | Account: ... | Bank: ...`) or legacy (`Method (Bank): 123`) payment lines. */
export function parseAccountDetailsEntries(raw: string, fallbackHolder = ''): ParsedPaymentEntry[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  return lines.map((line) => {
    if (line.includes(' | ')) {
      const segs = line.split(' | ').map((s) => s.trim())
      const methodName = segs[0] ?? ''
      let holderName = fallbackHolder
      let accountNumber = ''
      let bankOrType = ''
      let branchName = ''
      let routingNumber = ''
      let remarks = ''
      for (const seg of segs.slice(1)) {
        const idx = seg.indexOf(':')
        if (idx === -1) continue
        const key = seg.slice(0, idx).trim().toLowerCase()
        const val = seg.slice(idx + 1).trim()
        if (key === 'name' || key === 'holder') holderName = val
        else if (key === 'account' || key === 'number') accountNumber = val
        else if (key === 'bank' || key === 'type') bankOrType = val
        else if (key === 'branch') branchName = val
        else if (key === 'routing') routingNumber = val
        else if (key === 'remarks' || key === 'note') remarks = val
      }
      return {
        methodName,
        holderName: holderName || fallbackHolder,
        accountNumber,
        bankOrType,
        branchName,
        routingNumber,
        remarks,
        rawLine: line,
      }
    }

    // Legacy format: `Bank transfer (The City Bank): 01234567896 — Holder` or `bKash (Personal): 01965847521`
    const legacyMatch = line.match(/^([^(:]+?)(?:\s*\(([^)]+)\))?\s*:\s*(.+)$/)
    if (legacyMatch) {
      const methodName = legacyMatch[1]?.trim() ?? ''
      const bankOrType = legacyMatch[2]?.trim() ?? ''
      const rest = legacyMatch[3]?.trim() ?? ''
      const dashIdx = rest.indexOf(' — ')
      const accountNumber = dashIdx >= 0 ? rest.slice(0, dashIdx).trim() : rest
      const holderFromLine = dashIdx >= 0 ? rest.slice(dashIdx + 3).trim() : ''
      return {
        methodName,
        holderName: holderFromLine || fallbackHolder,
        accountNumber,
        bankOrType,
        branchName: '',
        routingNumber: '',
        remarks: '',
        rawLine: line,
      }
    }

    return {
      methodName: '',
      holderName: fallbackHolder,
      accountNumber: line,
      bankOrType: '',
      branchName: '',
      routingNumber: '',
      remarks: '',
      rawLine: line,
    }
  })
}

const ORDER_METHOD_STORAGE_PREFIX = 'onpeer:order-method:'

export function saveOrderChosenMethod(orderId: bigint, methodBit: number): void {
  try {
    sessionStorage.setItem(`${ORDER_METHOD_STORAGE_PREFIX}${orderId.toString()}`, String(methodBit))
  } catch {
    // ignore storage errors
  }
}

export function loadOrderChosenMethod(orderId: bigint): number | null {
  try {
    const raw = sessionStorage.getItem(`${ORDER_METHOD_STORAGE_PREFIX}${orderId.toString()}`)
    if (raw === null || !/^\d+$/.test(raw)) return null
    const n = Number(raw)
    return n >= 0 && n <= 31 ? n : null
  } catch {
    return null
  }
}

export function useSavedPaymentMethods() {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const queryClient = useQueryClient()

  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)
  const queryKey = ['p2p-payment-methods', normalizedWallet, session?.token ?? null] as const

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch<{ paymentMethods: SavedPaymentMethod[] }>('/account/payment-methods')
      return res.paymentMethods ?? []
    },
    enabled: isSignedIn,
    staleTime: 30_000,
  })

  const saveMutation = useMutation({
    mutationFn: async (next: SavedPaymentMethod[]) => {
      const res = await apiFetch<{ paymentMethods: SavedPaymentMethod[] }>('/account/payment-methods', {
        method: 'PUT',
        body: { paymentMethods: next },
      })
      return res.paymentMethods
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved)
    },
  })

  return {
    isSignedIn,
    methods: query.data ?? [],
    isLoading: query.isLoading,
    saveMethods: saveMutation.mutateAsync,
    saving: saveMutation.isPending,
    refetch: query.refetch,
  }
}

export function useP2pAccount() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const session = useBackendSession()
  const queryClient = useQueryClient()

  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)

  // L-01b: Clear stale session immediately if the user switches OR disconnects wallets
  useEffect(() => {
    if (session && (!isConnected || !normalizedWallet || session.wallet !== normalizedWallet)) {
      clearBackendSession()
    }
  }, [session, isConnected, normalizedWallet])

  const profileQuery = useQuery({
    queryKey: ['p2p-account', normalizedWallet, session?.token ?? null],
    queryFn: () => apiFetch<P2pAccountProfile>('/account'),
    enabled: isSignedIn,
    staleTime: 15_000,
  })

  const signInMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Connect wallet first')
      return signInWithWallet(address, signMessageAsync)
    },
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ['p2p-account', s.wallet] })
    },
  })

  const signOutMutation = useMutation({
    mutationFn: () => signOutFromBackend(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['p2p-account'] })
    },
  })

  const saveMutation = useMutation({
    mutationFn: (input: UpsertAccountInput) =>
      apiFetch<P2pAccountProfile>('/account', { method: 'PUT', body: input }),
    onSuccess: (next) => {
      queryClient.setQueryData(['p2p-account', normalizedWallet, session?.token ?? null], next)
    },
  })

  const resendVerifyMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ queued: boolean; reason?: string }>('/account/email/resend', { method: 'POST' }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/account', { method: 'DELETE' }),
    onSuccess: () => {
      clearBackendSession()
      queryClient.removeQueries({ queryKey: ['p2p-account'] })
    },
  })

  return {
    isConnected,
    wallet: normalizedWallet,
    isSignedIn,
    profile: profileQuery.data ?? null,
    isLoading: profileQuery.isLoading,
    error: profileQuery.error,
    refetch: profileQuery.refetch,
    signIn: signInMutation.mutateAsync,
    signingIn: signInMutation.isPending,
    signOut: signOutMutation.mutateAsync,
    saveAccount: saveMutation.mutateAsync,
    saving: saveMutation.isPending,
    resendVerification: resendVerifyMutation.mutateAsync,
    resending: resendVerifyMutation.isPending,
    deleteAccount: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
  }
}

export async function verifyEmailToken(token: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/email/verify', {
    method: 'POST',
    body: { token },
    auth: false,
  })
}

export async function unsubscribeEmailToken(token: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/email/unsubscribe', {
    method: 'POST',
    body: { token },
    auth: false,
  })
}

export interface TelegramAlertStatus {
  configured: boolean
  botUsername: string | null
  linked: boolean
  username: string | null
  optIn: boolean
  linkedAt: string | null
}

export function useTelegramAlerts(pollWhileWaiting = false) {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const queryClient = useQueryClient()

  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)
  const queryKey = ['p2p-telegram', normalizedWallet, session?.token ?? null] as const

  const statusQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<TelegramAlertStatus>('/telegram/status'),
    enabled: isSignedIn,
    staleTime: 10_000,
    refetchInterval: pollWhileWaiting ? 3_000 : false,
  })

  const linkMiniAppMutation = useMutation({
    mutationFn: (initData: string) =>
      apiFetch<{ ok: boolean; linked: boolean; username: string | null; optIn: boolean; allowsWriteToPm: boolean }>(
        '/telegram/link-miniapp',
        { method: 'POST', body: { initData } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const mintLinkTokenMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ botUsername: string; deepLink: string; expiresInSeconds: number }>('/telegram/link-token', {
        method: 'POST',
      }),
  })

  const toggleOptInMutation = useMutation({
    mutationFn: (optIn: boolean) =>
      apiFetch<{ ok: boolean; optIn: boolean }>('/telegram/preferences', {
        method: 'PUT',
        body: { optIn },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const sendTestMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/telegram/test', { method: 'POST' }),
  })

  const unlinkMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/telegram/link', { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  return {
    isSignedIn,
    status: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading,
    refetch: statusQuery.refetch,
    linkMiniApp: linkMiniAppMutation.mutateAsync,
    linkingMiniApp: linkMiniAppMutation.isPending,
    mintLinkToken: mintLinkTokenMutation.mutateAsync,
    mintingToken: mintLinkTokenMutation.isPending,
    setOptIn: toggleOptInMutation.mutateAsync,
    updatingOptIn: toggleOptInMutation.isPending,
    sendTest: sendTestMutation.mutateAsync,
    sendingTest: sendTestMutation.isPending,
    unlink: unlinkMutation.mutateAsync,
    unlinking: unlinkMutation.isPending,
  }
}

export interface KycScenarioOption {
  slug: string
  label: string
}

export interface KycStatusPayload {
  mode: 'sandbox' | 'live'
  scenarios: KycScenarioOption[]
  hasConsent: boolean
  kycStatus: 'none' | 'pending' | 'in_review' | 'approved' | 'declined' | 'expired' | 'revoked'
  kycLevel: number
  kycExpiresAt: string | null
  onchainVerified: boolean
  latestSession: {
    sessionId: string
    status: string
    sandboxScenario: string | null
    createdAt: string
    decidedAt: string | null
  } | null
  latestJob: {
    kind: string
    status: string
    attempts: number
    txHash: string | null
    lastError: string | null
  } | null
}

export function useKycStatus() {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const queryClient = useQueryClient()
  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)

  const statusQuery = useQuery({
    queryKey: ['p2p-kyc', normalizedWallet, session?.token ?? null],
    queryFn: () => apiFetch<KycStatusPayload>('/kyc/status'),
    enabled: isSignedIn,
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d) return false
      if (d.kycStatus === 'pending' || d.kycStatus === 'in_review') return 5_000
      if (d.latestJob && (d.latestJob.status === 'pending' || d.latestJob.status === 'processing')) return 5_000
      return 30_000
    },
  })

  const startMutation = useMutation({
    mutationFn: (input: { sandboxScenario?: string; consent?: boolean }) =>
      apiFetch<{
        sessionId: string
        url: string
        status: string
        mode: 'sandbox' | 'live'
        sandboxScenario: string | null
      }>('/kyc/start', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['p2p-kyc', normalizedWallet] })
      void queryClient.invalidateQueries({ queryKey: ['p2p-account', normalizedWallet] })
    },
  })

  return {
    isSignedIn,
    data: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading,
    refetch: statusQuery.refetch,
    startKyc: startMutation.mutateAsync,
    starting: startMutation.isPending,
  }
}
