import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import { ZERO_BYTES32 } from '@/lib/p2p'
import { apiFetch, getBackendSession, signInWithWallet, useBackendSession } from '@/lib/api'

export interface NameMatchBadgeData {
  status: 'match' | 'mismatch' | 'unverified'
  maskedInitials: string | null
}

export interface OrderVaultResponse {
  orderId: string
  viewerRole: 'buyer' | 'seller' | 'arbiter' | 'backup_arbiter'
  sellerDetails: {
    sealed: true
    verifiedHash: true
    contentHash: string
    holderName: string
    accountDetails: string
    notes: string
    kycNameMatch: NameMatchBadgeData
  } | null
  buyerPayer: {
    sealed: true
    verifiedHash: true
    contentHash: string
    transferId: string
    senderName: string
    last4: string
    kycNameMatch: NameMatchBadgeData
  } | null
}

export function useVaultActions() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  const ensureSession = async () => {
    if (!address) throw new Error('Connect wallet first')
    const current = getBackendSession()
    if (current && current.wallet === address.toLowerCase()) return current
    return signInWithWallet(address, signMessageAsync)
  }

  const sealDetails = async (input: {
    kind: 'ad_details' | 'order_details'
    holderName: string
    accountDetails: string
    notes?: string
  }): Promise<{ id: string; contentHash: `0x${string}` }> => {
    await ensureSession()
    return apiFetch<{ id: string; contentHash: `0x${string}` }>('/vault/details', {
      method: 'POST',
      body: input,
    })
  }

  const bindAdDetails = async (blobId: string, adId: bigint): Promise<void> => {
    await apiFetch('/vault/bind-ad', {
      method: 'POST',
      body: { blobId, adId: adId.toString() },
    }).catch(() => undefined)
  }

  const sealPayerProof = async (input: {
    orderId: bigint
    transferId: string
    senderName: string
    last4: string
  }): Promise<{ id: string; contentHash: `0x${string}` }> => {
    await ensureSession()
    const res = await apiFetch<{ id: string; contentHash: `0x${string}` }>('/vault/payer', {
      method: 'POST',
      body: {
        orderId: input.orderId.toString(),
        transferId: input.transferId,
        senderName: input.senderName,
        last4: input.last4,
      },
    })
    void queryClient.invalidateQueries({ queryKey: ['order-vault', input.orderId.toString()] })
    return res
  }

  return { ensureSession, sealDetails, bindAdDetails, sealPayerProof }
}

export function useOrderVault(
  orderId: bigint,
  detailsHash: `0x${string}`,
  payerProof: `0x${string}`,
  canAccess: boolean,
) {
  const { address, isConnected } = useAccount()
  const session = useBackendSession()
  const normalizedWallet = address?.toLowerCase() ?? null
  const isSignedIn = !!(isConnected && normalizedWallet && session && session.wallet === normalizedWallet)
  const hasAnyHash = detailsHash !== ZERO_BYTES32 || payerProof !== ZERO_BYTES32

  return useQuery({
    queryKey: ['order-vault', orderId.toString(), detailsHash, payerProof, session?.token ?? null],
    queryFn: () => apiFetch<OrderVaultResponse>(`/orders/${orderId.toString()}/vault`),
    enabled: isSignedIn && canAccess && hasAnyHash,
    staleTime: 10_000,
    retry: 1,
  })
}
