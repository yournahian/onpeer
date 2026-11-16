import { createElement, useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { erc20Abi, type Hash } from 'viem'
import { toast } from 'sonner'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, ESCROW_ADDRESS, parseTxError } from '@/lib/p2p'
import { USDC_ADDRESS } from '@/hooks/useEscrow'

/**
 * Runs one onchain write: switches chain if needed, waits for the real receipt,
 * refreshes all reads, and reports honest success or failure.
 */
export function useTx() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, label: string, send: () => Promise<Hash>): Promise<boolean> => {
      setPendingKey(key)
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        const hash = await send()
        const toastId = toast.loading(`${label}: confirming...`)
        const receipt = await publicClient!.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') {
          toast.error(`${label} failed onchain.`, { id: toastId })
          return false
        }
        const url = buildTxExplorerUrl(CHAIN_ID, hash)
        toast.success(`${label}: confirmed`, {
          id: toastId,
          action: url
            ? createElement(
                'a',
                { href: url, target: '_blank', rel: 'noopener noreferrer', className: 'underline' },
                'View',
              )
            : undefined,
        })
        await queryClient.invalidateQueries()
        return true
      } catch (err) {
        const copy = parseTxError(err)
        if (copy) toast.error(copy)
        return false
      } finally {
        setPendingKey(null)
      }
    },
    [chainId, switchChainAsync, publicClient, queryClient],
  )

  const approveUsdc = useCallback(
    (amount: bigint) =>
      run('approve', 'Approve USDC', () =>
        writeContractAsync({
          address: USDC_ADDRESS!,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ESCROW_ADDRESS!, amount],
          chainId: CHAIN_ID,
        }),
      ),
    [run, writeContractAsync],
  )

  return { run, approveUsdc, writeContractAsync, pendingKey, busy: pendingKey !== null }
}
