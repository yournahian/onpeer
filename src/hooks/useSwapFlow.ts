import { useCallback, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import type { SwapEstimate } from '@circle-fin/app-kit'
import { getUsdc } from '@/onchain-facts'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { appKit, adapterFromConnector, kitErrorMessage } from '@/lib/appkit'

export type SwapToken = 'USDC' | 'EURC'
export type SwapPhase = 'idle' | 'quoting' | 'quoted' | 'swapping' | 'done' | 'error'

const rawEurc = (import.meta.env.VITE_ARC_TESTNET_EURC_ADDRESS as string | undefined)?.trim()
const TOKEN_ADDRESS: Record<SwapToken, Address | undefined> = {
  USDC: getUsdc(arcTestnet.id)?.address as Address | undefined,
  EURC: rawEurc && /^0x[0-9a-fA-F]{40}$/.test(rawEurc) ? (rawEurc as Address) : undefined,
}

export const SLIPPAGE_OPTIONS = [50, 100, 300] as const

export type SwapDone = { amountOut?: string; explorerUrl?: string; status: string }

/**
 * One swap, step by step: quote, explicit confirm, result. Nothing moves funds except execute(),
 * which the UI must call from a user click.
 */
export function useSwapFlow({
  tokenIn,
  amount,
  onSettled,
}: {
  tokenIn: SwapToken
  amount: string
  onSettled?: (text: string) => void
}) {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const client = usePublicClient({ chainId: arcTestnet.id })
  const [phase, setPhase] = useState<SwapPhase>('idle')
  const [estimate, setEstimate] = useState<SwapEstimate | null>(null)
  const [slippage, setSlippage] = useState<number>(100)
  const [done, setDone] = useState<SwapDone | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reviewedAccount = useRef<string | undefined>(undefined)
  const tokenOut: SwapToken = tokenIn === 'USDC' ? 'EURC' : 'USDC'

  const prepare = useCallback(async () => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== arcTestnet.id) await switchChainAsync({ chainId: arcTestnet.id })
    return adapterFromConnector(connector)
  }, [chainId, connector, switchChainAsync])

  const quote = useCallback(
    async (bps: number = slippage) => {
      setPhase('quoting')
      setError(null)
      setSlippage(bps)
      try {
        const tokenAddress = TOKEN_ADDRESS[tokenIn]
        if (client && address && tokenAddress) {
          const balance = await client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          })
          if (balance < parseUsdc(amount)) {
            setError(`Not enough ${tokenIn}: you have ${formatUsdc(balance)}. Use "Get test USDC" in the Arc Studio sidebar.`)
            setPhase('error')
            return
          }
        }
        const adapter = await prepare()
        const result = await appKit.estimateSwap({
          from: { adapter, chain: 'Arc_Testnet' },
          tokenIn,
          tokenOut,
          amountIn: amount,
          config: { slippageBps: bps },
        })
        reviewedAccount.current = address
        setEstimate(result)
        setPhase('quoted')
      } catch (err) {
        setError(kitErrorMessage(err))
        setPhase(kitErrorMessage(err) === null ? 'idle' : 'error')
      }
    },
    [address, amount, client, prepare, slippage, tokenIn, tokenOut],
  )

  const execute = useCallback(async () => {
    if (phase !== 'quoted' || reviewedAccount.current !== address) {
      setError('Your wallet changed since the quote. Review a new quote.')
      setPhase('error')
      return
    }
    setPhase('swapping')
    setError(null)
    try {
      const adapter = await prepare()
      const result = await appKit.swap({
        from: { adapter, chain: 'Arc_Testnet' },
        tokenIn,
        tokenOut,
        amountIn: amount,
        config: { slippageBps: slippage },
      })
      const info = { amountOut: result.amountOut, explorerUrl: result.explorerUrl, status: result.progress.status }
      setDone(info)
      setPhase('done')
      onSettled?.(
        info.status === 'DONE'
          ? `Swap complete: ${amount} ${tokenIn} to ${info.amountOut ?? tokenOut}.`
          : `Swap submitted: ${amount} ${tokenIn} to ${tokenOut}.`,
      )
    } catch (err) {
      const message = kitErrorMessage(err)
      setError(message)
      setPhase(message === null ? 'quoted' : 'error')
    }
  }, [address, amount, onSettled, phase, prepare, slippage, tokenIn, tokenOut])

  const reset = useCallback(() => {
    setPhase('idle')
    setEstimate(null)
    setError(null)
  }, [])

  return { phase, estimate, slippage, done, error, tokenOut, quote, execute, reset, isConnected: !!address }
}
