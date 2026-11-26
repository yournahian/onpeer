import { useAccount, useReadContract } from 'wagmi'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, sameAddr } from '@/lib/p2p'
import { useArbiter, useBackupArbiter } from '@/hooks/useEscrow'

/** Who the connected wallet is relative to the escrow contract: owner, arbiter, backupArbiter or none. */
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
  const backupArbiter = useBackupArbiter()
  const roleMask = useReadContract({
    address: ESCROW_ADDRESS,
    abi: p2pEscrowAbi,
    chainId: CHAIN_ID,
    functionName: 'arbiterRole',
    args: address ? [address] : undefined,
    query: { enabled: !!ESCROW_ADDRESS && !!address, refetchInterval: 30_000 },
  })
  const mask = Number(roleMask.data ?? 0)
  const isOwner = sameAddr(address, owner.data)
  const isArbiter = sameAddr(address, arbiter) || (mask & 1) !== 0
  const isBackupArbiter = sameAddr(address, backupArbiter) || (mask & 2) !== 0
  return {
    address,
    isConnected,
    owner: owner.data,
    arbiter,
    backupArbiter,
    isOwner,
    isArbiter,
    isBackupArbiter,
    isAdmin: isOwner || isArbiter || isBackupArbiter,
    loading: owner.isLoading,
  }
}
