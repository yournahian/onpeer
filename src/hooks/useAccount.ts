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

export function useP2pAccount() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const session = useBackendSession()
  const queryClient = useQueryClient()

  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)

  // Clear stale session immediately if the user switches or disconnects wallets
  useEffect(() => {
    if (session && normalizedWallet && session.wallet !== normalizedWallet) {
      clearBackendSession()
    }
  }, [session, normalizedWallet])

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
