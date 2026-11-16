import { useAccount, useReadContract } from 'wagmi'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, sameAddr } from '@/lib/p2p'
import { useArbiter } from '@/hooks/useEscrow'

/** Who the connected wallet is relative to the escrow contract: owner, arbiter, both or neither. */
export function useAdminRoles() {
  const { address, isConnected } = useAccount()
  const owner = useReadContract({
    address: ESCROW_ADDRESS,
    abi: p2pEscrowAbi,
    chainId: CHAIN_ID,
    functionName: 'owner',
    query: { enabled: !!ESCROW_ADDRESS, refetchInterval: 30_000 },
  })
  const arbiter = useArbiter()
  const isOwner = sameAddr(address, owner.data)
  const isArbiter = sameAddr(address, arbiter)
  return {
    address,
    isConnected,
    owner: owner.data,
    arbiter,
    isOwner,
    isArbiter,
    isAdmin: isOwner || isArbiter,
    loading: owner.isLoading,
  }
}
