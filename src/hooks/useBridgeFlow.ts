import { useCallback, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import {
  arbitrumSepolia,
  arcTestnet,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
  sepolia,
} from 'viem/chains'
import type { BridgeResult } from '@circle-fin/app-kit'
import { getUsdc } from '@/onchain-facts'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { appKit, adapterFromConnector, kitErrorMessage } from '@/lib/appkit'

export const BRIDGE_CHAINS = [
  { kit: 'Arc_Testnet', label: 'Arc Testnet', id: arcTestnet.id },
  { kit: 'Ethereum_Sepolia', label: 'Ethereum Sepolia', id: sepolia.id },
  { kit: 'Base_Sepolia', label: 'Base Sepolia', id: baseSepolia.id },
  { kit: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia', id: arbitrumSepolia.id },
  { kit: 'Optimism_Sepolia', label: 'Optimism Sepolia', id: optimismSepolia.id },
  { kit: 'Avalanche_Fuji', label: 'Avalanche Fuji', id: avalancheFuji.id },
  { kit: 'Polygon_Amoy_Testnet', label: 'Polygon Amoy', id: polygonAmoy.id },
] as const

export type BridgeChainName = (typeof BRIDGE_CHAINS)[number]['kit']
export type BridgePhase = 'idle' | 'quoting' | 'quoted' | 'bridging' | 'done' | 'failed' | 'error'
export type StepState = 'idle' | 'running' | 'done' | 'error'

export const STEP_ORDER = ['approve', 'burn', 'fetchAttestation', 'mint'] as const
export const STEP_LABELS: Record<string, string> = {
  approve: 'Approve USDC',
  burn: 'Burn on source chain',
  fetchAttestation: 'Circle attestation',
  mint: 'Mint on destination',
}

export type BridgeQuote = {
  fees: { type: string; amount: string | null; token: string }[]
  gas: { name: string; fee: string; token: string }[]
}

export const chainLabel = (kit: BridgeChainName) => BRIDGE_CHAINS.find((c) => c.kit === kit)?.label ?? kit

/**
 * One bridge transfer, step by step: quote, explicit confirm, live progress, retry.
 * Only execute() and retry() move funds, and the UI must call them from a user click.
 */
export function useBridgeFlow({
  from,
  to,
  amount,
  onSettled,
}: {
  from: BridgeChainName
  to: BridgeChainName
  amount: string
  onSettled?: (text: string) => void
}) {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const source = BRIDGE_CHAINS.find((c) => c.kit === from) ?? BRIDGE_CHAINS[0]
  const client = usePublicClient({ chainId: source.id })
  const [phase, setPhase] = useState<BridgePhase>('idle')
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [result, setResult] = useState<BridgeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reviewedAccount = useRef<string | undefined>(undefined)
  const adapterRef = useRef<Awaited<ReturnType<typeof adapterFromConnector>> | null>(null)

  const prepare = useCallback(async () => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== source.id) await switchChainAsync({ chainId: source.id })
    const adapter = await adapterFromConnector(connector)
    adapterRef.current = adapter
    return adapter
  }, [chainId, connector, source.id, switchChainAsync])

  const getQuote = useCallback(async () => {
    setPhase('quoting')
    setError(null)
    try {
      const usdc = getUsdc(source.id)?.address as Address | undefined
      if (client && address && usdc) {
        const balance = await client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })
        if (balance < parseUsdc(amount)) {
          setError(`Not enough USDC on ${source.label}: you have ${formatUsdc(balance)}.`)
          setPhase('error')
          return
        }
      }
      const adapter = await prepare()
      const est = await appKit.estimateBridge({
        from: { adapter, chain: from },
        to: { adapter, chain: to, useForwarder: true },
        amount,
      })
      reviewedAccount.current = address
      setQuote({
        fees: est.fees.map((f) => ({ type: f.type, amount: f.amount, token: f.token })),
        gas: est.gasFees.filter((g) => g.fees).map((g) => ({ name: g.name, fee: g.fees!.fee, token: g.token })),
      })
      setPhase('quoted')
    } catch (err) {
      const message = kitErrorMessage(err)
      setError(message)
      setPhase(message === null ? 'idle' : 'error')
    }
  }, [address, amount, client, from, prepare, source.id, source.label, to])

  const finish = useCallback(
    (res: BridgeResult) => {
      setResult(res)
      const next: Record<string, StepState> = {}
      for (const s of res.steps) next[s.name] = s.state === 'success' ? 'done' : s.state === 'error' ? 'error' : 'idle'
      setSteps(next)
      if (res.state === 'success') {
        setPhase('done')
        onSettled?.(`Bridge complete: ${amount} USDC from ${chainLabel(from)} to ${chainLabel(to)}.`)
      } else {
        setPhase('failed')
      }
    },
    [amount, from, onSettled, to],
  )

  /** Subscribes to real kit events for the duration of one call, then unsubscribes. */
  const withProgress = useCallback(async (run: () => Promise<BridgeResult>) => {
    const handlers = STEP_ORDER.map((name) => [name, () => setSteps((s) => ({ ...s, [name]: 'done' }))] as const)
    for (const [name, h] of handlers) appKit.on(`bridge.${name}` as 'bridge.approve', h)
    try {
      return await run()
    } finally {
      for (const [name, h] of handlers) appKit.off(`bridge.${name}` as 'bridge.approve', h)
    }
  }, [])

  const execute = useCallback(async () => {
    if (phase !== 'quoted' || reviewedAccount.current !== address) {
      setError('Your wallet changed since the quote. Review a new quote.')
      setPhase('error')
      return
    }
    setPhase('bridging')
    setError(null)
    setResult(null)
    setSteps({ approve: 'running' })
    try {
      const adapter = await prepare()
      const res = await withProgress(() =>
        appKit.bridge({
          from: { adapter, chain: from },
          to: { adapter, chain: to, useForwarder: true },
          amount,
        }),
      )
      finish(res)
    } catch (err) {
      const message = kitErrorMessage(err)
      setError(message)
      setSteps({})
      setPhase(message === null ? 'quoted' : 'error')
    }
  }, [address, amount, finish, from, phase, prepare, to, withProgress])

  const retry = useCallback(async () => {
    if (!result || !adapterRef.current) return
    setPhase('bridging')
    setError(null)
    try {
      const adapter = await prepare()
      const res = await withProgress(() => appKit.retryBridge(result, { from: adapter, to: adapter }))
      finish(res)
    } catch (err) {
      setError(kitErrorMessage(err))
      setPhase('failed')
    }
  }, [finish, prepare, result, withProgress])

  const reset = useCallback(() => {
    setPhase('idle')
    setQuote(null)
    setError(null)
  }, [])

  return { phase, quote, steps, result, error, getQuote, execute, retry, reset, isConnected: !!address }
}
