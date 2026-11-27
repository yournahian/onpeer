import { useCallback, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import type { SwapEstimate } from '@circle-fin/app-kit'
import { buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import { appKit, adapterFromConnector, kitErrorMessage } from '@/lib/appkit'
import {
  AchSwapError,
  fetchAchSwapBuild,
  fetchAchSwapQuote,
  formatAchSwapFees,
  toAchSwapInput,
  toAchSwapOutput,
} from '@/lib/achswap'
import { ACTIVE_CHAIN_ID, ARC_KIT_CHAIN, IS_TESTNET } from '@/lib/network'

export const SWAP_TOKENS = ['USDC', 'EURC', 'cirBTC', 'WETH'] as const
export type SwapToken = (typeof SWAP_TOKENS)[number]
export type SwapPhase = 'idle' | 'quoting' | 'quoted' | 'swapping' | 'done' | 'error'

const DEFAULT_EURC_ADDR = (
  IS_TESTNET
    ? '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'
    : '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
) as Address
const DEFAULT_CIRBTC_ADDR = (
  IS_TESTNET
    ? '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF'
    : '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0'
) as Address
const DEFAULT_WETH_ADDR = '0x2c4047028a72803939b6fb674D01bC059B5C4961' as Address

export const SWAP_TOKEN_DECIMALS: Record<SwapToken, number> = {
  USDC: 6,
  EURC: 6,
  cirBTC: 8,
  WETH: 18,
}

export const SWAP_TOKEN_ADDRESS: Record<SwapToken, Address | undefined> = {
  USDC: getUsdc(ACTIVE_CHAIN_ID)?.address as Address | undefined,
  EURC: DEFAULT_EURC_ADDR,
  cirBTC: DEFAULT_CIRBTC_ADDR,
  WETH: DEFAULT_WETH_ADDR,
}

/** App Kit selector on Arc: WETH uses its Arc Testnet contract address on testnet so the registry resolves cleanly. */
export function toSwapKitToken(token: SwapToken): string {
  if (token === 'WETH' && IS_TESTNET) return DEFAULT_WETH_ADDR
  return token
}

export function defaultSwapCounterpart(tokenIn: SwapToken): SwapToken {
  return tokenIn === 'USDC' ? 'EURC' : 'USDC'
}

export const SLIPPAGE_OPTIONS = [50, 100, 300] as const

export type SwapDone = { amountOut?: string; explorerUrl?: string; status: string }

/**
 * One swap, step by step: quote, explicit confirm, result. Nothing moves funds except execute(),
 * which the UI must call from a user click.
 */
export function useSwapFlow({
  tokenIn,
  tokenOut: requestedOut,
  amount,
  onSettled,
}: {
  tokenIn: SwapToken
  tokenOut?: SwapToken
  amount: string
  onSettled?: (text: string) => void
}) {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: ACTIVE_CHAIN_ID })
  const [phase, setPhase] = useState<SwapPhase>('idle')
  const [estimate, setEstimate] = useState<SwapEstimate | null>(null)
  const [slippage, setSlippage] = useState<number>(100)
  const [done, setDone] = useState<SwapDone | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reviewedAccount = useRef<string | undefined>(undefined)
  const tokenOut: SwapToken =
    requestedOut && requestedOut !== tokenIn ? requestedOut : defaultSwapCounterpart(tokenIn)

  const prepare = useCallback(async () => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== ACTIVE_CHAIN_ID) await switchChainAsync({ chainId: ACTIVE_CHAIN_ID })
    return adapterFromConnector(connector)
  }, [chainId, connector, switchChainAsync])

  const quote = useCallback(
    async (bps: number = slippage) => {
      setPhase('quoting')
      setError(null)
      setSlippage(bps)
      try {
        const tokenAddress = SWAP_TOKEN_ADDRESS[tokenIn]
        const decimals = SWAP_TOKEN_DECIMALS[tokenIn]
        const decimalsOut = SWAP_TOKEN_DECIMALS[tokenOut]
        const amountRaw = parseUnitsExact(amount, decimals)
        if (client && address && tokenAddress) {
          const balance = await client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          })
          if (balance < amountRaw) {
            setError(`Not enough ${tokenIn}: you have ${formatUnitsExact(balance, decimals)}.`)
            setPhase('error')
            return
          }
        }

        if (!IS_TESTNET) {
          const { tokenIn: achIn, amountIn: achAmount } = toAchSwapInput(tokenIn, tokenAddress, amountRaw)
          const achOut = toAchSwapOutput(tokenOut, SWAP_TOKEN_ADDRESS[tokenOut])
          const q = await fetchAchSwapQuote({
            tokenIn: achIn,
            tokenOut: achOut,
            amountIn: achAmount,
            slippageBps: bps,
          })
          const synthetic = {
            estimatedOutput: { amount: formatUnitsExact(BigInt(q.amountOut), decimalsOut), token: tokenOut },
            fees: formatAchSwapFees(q.fees, tokenOut, decimalsOut),
          } as unknown as SwapEstimate
          reviewedAccount.current = address
          setEstimate(synthetic)
          setPhase('quoted')
          return
        }

        const adapter = await prepare()
        const result = await appKit.estimateSwap({
          from: { adapter, chain: ARC_KIT_CHAIN },
          tokenIn: toSwapKitToken(tokenIn),
          tokenOut: toSwapKitToken(tokenOut),
          amountIn: amount,
          config: { slippageBps: bps },
        })
        reviewedAccount.current = address
        setEstimate(result)
        setPhase('quoted')
      } catch (err) {
        const msg = err instanceof AchSwapError ? err.message : kitErrorMessage(err)
        setError(msg)
        setPhase(msg === null ? 'idle' : 'error')
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
      if (!IS_TESTNET) {
        if (!address) throw new Error('Wallet not connected')
        if (chainId !== ACTIVE_CHAIN_ID) await switchChainAsync({ chainId: ACTIVE_CHAIN_ID })
        const decimals = SWAP_TOKEN_DECIMALS[tokenIn]
        const decimalsOut = SWAP_TOKEN_DECIMALS[tokenOut]
        const amountRaw = parseUnitsExact(amount, decimals)
        const { tokenIn: achIn, amountIn: achAmount } = toAchSwapInput(tokenIn, SWAP_TOKEN_ADDRESS[tokenIn], amountRaw)
        const achOut = toAchSwapOutput(tokenOut, SWAP_TOKEN_ADDRESS[tokenOut])
        const built = await fetchAchSwapBuild({
          tokenIn: achIn,
          tokenOut: achOut,
          amountIn: achAmount,
          slippageBps: slippage,
          sender: address,
        })
        if (built.approval) {
          const currentAllowance = client
            ? await client.readContract({
                address: built.approval.token,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [address, built.approval.spender],
              })
            : 0n
          const needed = BigInt(built.approval.amount)
          if (currentAllowance < needed) {
            const approveHash = await writeContractAsync({
              address: built.approval.token,
              abi: erc20Abi,
              functionName: 'approve',
              args: [built.approval.spender, needed],
              chainId: ACTIVE_CHAIN_ID,
            })
            if (client) await client.waitForTransactionReceipt({ hash: approveHash })
          }
        }
        const txHash = await sendTransactionAsync({
          to: built.tx.to,
          data: built.tx.data,
          value: BigInt(built.tx.value || '0'),
          gas: built.tx.gas ? BigInt(built.tx.gas) : undefined,
          chainId: ACTIVE_CHAIN_ID,
        })
        if (client) await client.waitForTransactionReceipt({ hash: txHash })
        const formattedOut = formatUnitsExact(BigInt(built.amountOut), decimalsOut)
        const info = {
          amountOut: formattedOut,
          explorerUrl: buildTxExplorerUrl(ACTIVE_CHAIN_ID, txHash),
          status: 'DONE',
        }
        setDone(info)
        setPhase('done')
        onSettled?.(`Swap complete: ${amount} ${tokenIn} to ${formattedOut} ${tokenOut}.`)
        return
      }

      const adapter = await prepare()
      const result = await appKit.swap({
        from: { adapter, chain: ARC_KIT_CHAIN },
        tokenIn: toSwapKitToken(tokenIn),
        tokenOut: toSwapKitToken(tokenOut),
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
      const message = err instanceof AchSwapError ? err.message : kitErrorMessage(err)
      setError(message)
      setPhase(message === null ? 'quoted' : 'error')
    }
  }, [
    address,
    amount,
    chainId,
    client,
    onSettled,
    phase,
    prepare,
    sendTransactionAsync,
    slippage,
    switchChainAsync,
    tokenIn,
    tokenOut,
    writeContractAsync,
  ])

  const reset = useCallback(() => {
    setPhase('idle')
    setEstimate(null)
    setError(null)
  }, [])

  return { phase, estimate, slippage, done, error, tokenOut, quote, execute, reset, isConnected: !!address }
}
