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
import type { BridgeEstimateResult, BridgeResult } from '@circle-fin/app-kit'
import { getUsdc } from '@/onchain-facts'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
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

export const BRIDGE_TOKENS = ['USDC', 'EURC', 'cirBTC', 'WETH'] as const
export type BridgeToken = (typeof BRIDGE_TOKENS)[number]
export type BridgeTransferSpeed = 'FAST' | 'SLOW'

export type BridgeChainName = (typeof BRIDGE_CHAINS)[number]['kit']
export type BridgePhase = 'idle' | 'quoting' | 'quoted' | 'bridging' | 'done' | 'failed' | 'error'
export type StepState = 'idle' | 'running' | 'done' | 'error'

export const BRIDGE_TOKEN_DECIMALS: Record<BridgeToken, number> = {
  USDC: 6,
  EURC: 6,
  cirBTC: 8,
  WETH: 18,
}

/** Case-sensitive Bridge Kit / CCTPx registry alias (`"wETH"`, `"cirBTC"`, `"EURC"`, `"USDC"`). */
export function toBridgeKitToken(token: BridgeToken): 'USDC' | 'EURC' | 'cirBTC' | 'wETH' {
  if (token === 'WETH') return 'wETH'
  return token
}

/** Verified testnet ERC-20 addresses from Circle IRIS sandbox registry & Arc facts. */
const TESTNET_TOKEN_ADDRESSES: Record<BridgeToken, Partial<Record<BridgeChainName, Address>>> = {
  USDC: {
    Arc_Testnet: getUsdc(arcTestnet.id)?.address as Address | undefined,
    Ethereum_Sepolia: getUsdc(sepolia.id)?.address as Address | undefined,
    Base_Sepolia: getUsdc(baseSepolia.id)?.address as Address | undefined,
    Arbitrum_Sepolia: getUsdc(arbitrumSepolia.id)?.address as Address | undefined,
    Optimism_Sepolia: getUsdc(optimismSepolia.id)?.address as Address | undefined,
    Avalanche_Fuji: getUsdc(avalancheFuji.id)?.address as Address | undefined,
    Polygon_Amoy_Testnet: getUsdc(polygonAmoy.id)?.address as Address | undefined,
  },
  EURC: {
    Arc_Testnet: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    Ethereum_Sepolia: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
    Base_Sepolia: '0x808456652fdb597867f38412077A9182bf77359F',
    Avalanche_Fuji: '0x5E44db7996c682E92a960b65AC713a54AD815c6B',
  },
  cirBTC: {
    Arc_Testnet: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
    Ethereum_Sepolia: '0x3a3fe695F684Bf9b9e43CF43C2b895Ea5e392bB3',
  },
  WETH: {
    Arc_Testnet: '0x2c4047028a72803939b6fb674D01bC059B5C4961',
    Ethereum_Sepolia: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  },
}

export function getBridgeTokenAddress(token: BridgeToken, chain: BridgeChainName): Address | undefined {
  return TESTNET_TOKEN_ADDRESSES[token][chain]
}

export const USDC_STEP_ORDER = ['approve', 'burn', 'fetchAttestation', 'mint'] as const
export const CCTPX_STEP_ORDER = ['approve', 'transfer', 'fetchAttestation', 'forward'] as const
export const ALL_BRIDGE_EVENTS = ['approve', 'approveFee', 'burn', 'transfer', 'fetchAttestation', 'mint', 'forward'] as const

export function bridgeStepOrderFor(token: BridgeToken): readonly string[] {
  return token === 'USDC' ? USDC_STEP_ORDER : CCTPX_STEP_ORDER
}

export function bridgeStepLabel(stepName: string, token: BridgeToken): string {
  switch (stepName) {
    case 'approve':
      return `Approve ${token}`
    case 'approveFee':
      return 'Approve fee token'
    case 'burn':
      return 'Burn on source chain'
    case 'transfer':
      return 'Lock / burn via CCTPx'
    case 'fetchAttestation':
      return 'Circle IRIS attestation'
    case 'mint':
      return 'Mint on destination'
    case 'forward':
      return 'Relayer destination mint'
    default:
      return stepName
  }
}

export const STEP_ORDER = USDC_STEP_ORDER
export const STEP_LABELS: Record<string, string> = {
  approve: 'Approve token',
  approveFee: 'Approve fee token',
  burn: 'Burn on source chain',
  transfer: 'Lock / burn via CCTPx',
  fetchAttestation: 'Circle IRIS attestation',
  mint: 'Mint on destination',
  forward: 'Relayer destination mint',
}

export type BridgeQuote = {
  fees: { type: string; amount: string | null; token: string }[]
  gas: { name: string; fee: string; token: string }[]
  rawEstimate: BridgeEstimateResult
}

export const chainLabel = (kit: BridgeChainName) => BRIDGE_CHAINS.find((c) => c.kit === kit)?.label ?? kit

/**
 * One bridge transfer, step by step: quote, explicit confirm, live progress, retry.
 * Supports USDC over CCTP and EURC / cirBTC / WETH over CCTPx.
 */
export function useBridgeFlow({
  from,
  to,
  amount,
  token = 'USDC',
  speed = 'FAST',
  onSettled,
}: {
  from: BridgeChainName
  to: BridgeChainName
  amount: string
  token?: BridgeToken
  speed?: BridgeTransferSpeed
  onSettled?: (text: string) => void
}) {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const source = BRIDGE_CHAINS.find((c) => c.kit === from) ?? BRIDGE_CHAINS[0]
  const client = usePublicClient({ chainId: source.id })
  const [phase, setPhase] = useState<BridgePhase>('idle')
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [result, setResult] = useState<BridgeResult<string> | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
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
    setWarnings([])
    try {
      const tokenAddr = getBridgeTokenAddress(token, from)
      const decimals = BRIDGE_TOKEN_DECIMALS[token]
      if (client && address && tokenAddr) {
        const balance = await client.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })
        if (balance < parseUnitsExact(amount, decimals)) {
          setError(`Not enough ${token} on ${source.label}: you have ${formatUnitsExact(balance, decimals)}.`)
          setPhase('error')
          return
        }
      }
      const adapter = await prepare()
      const est =
        token === 'USDC'
          ? await appKit.estimateBridge({
            from: { adapter, chain: from },
            to: { adapter, chain: to, useForwarder: true },
            amount,
            token: 'USDC',
          })
          : await appKit.estimateBridge({
            from: { adapter, chain: from },
            to: { adapter, chain: to },
            amount,
            token: toBridgeKitToken(token),
            config: { transferSpeed: speed },
          })
      reviewedAccount.current = address
      setQuote({
        fees: est.fees.map((f) => ({ type: f.type, amount: f.amount, token: f.token })),
        gas: est.gasFees.filter((g) => g.fees).map((g) => ({ name: g.name, fee: g.fees!.fee, token: g.token })),
        rawEstimate: est,
      })
      setPhase('quoted')
    } catch (err) {
      const message = kitErrorMessage(err)
      setError(message)
      setPhase(message === null ? 'idle' : 'error')
    }
  }, [address, amount, client, from, prepare, source.label, speed, to, token])

  const finish = useCallback(
    (res: BridgeResult<string>) => {
      setResult(res)
      const resWarnings = ((res as { warnings?: { code?: string; message?: string }[] }).warnings ?? [])
        .map((w) => w.message || w.code || '')
        .filter(Boolean)
      setWarnings(resWarnings)
      const next: Record<string, StepState> = {}
      for (const s of res.steps) next[s.name] = s.state === 'success' ? 'done' : s.state === 'error' ? 'error' : 'idle'
      setSteps(next)
      if (res.state === 'success') {
        setPhase('done')
        onSettled?.(`Bridge complete: ${amount} ${token} from ${chainLabel(from)} to ${chainLabel(to)}.`)
      } else {
        setPhase('failed')
      }
    },
    [amount, from, onSettled, to, token],
  )

  /** Subscribes to real kit events for the duration of one call, then unsubscribes. */
  const withProgress = useCallback(async (run: () => Promise<BridgeResult<string>>) => {
    const handlers = ALL_BRIDGE_EVENTS.map((name) => [name, () => setSteps((s) => ({ ...s, [name]: 'done' }))] as const)
    for (const [name, h] of handlers) appKit.on(`bridge.${name}` as 'bridge.approve', h)
    try {
      return await run()
    } finally {
      for (const [name, h] of handlers) appKit.off(`bridge.${name}` as 'bridge.approve', h)
    }
  }, [])

  const execute = useCallback(async () => {
    if (phase !== 'quoted' || !quote || reviewedAccount.current !== address) {
      setError('Your wallet changed since the quote. Review a new quote.')
      setPhase('error')
      return
    }
    setPhase('bridging')
    setError(null)
    setResult(null)
    setWarnings([])
    setSteps({ approve: 'running' })
    try {
      const adapter = await prepare()
      const res = await withProgress(() =>
        token === 'USDC'
          ? appKit.bridge({
            from: { adapter, chain: from },
            to: { adapter, chain: to, useForwarder: true },
            amount,
            token: 'USDC',
          })
          : appKit.bridge({
            from: { adapter, chain: from },
            to: { adapter, chain: to },
            amount,
            token: toBridgeKitToken(token),
            config: { transferSpeed: speed },
            quote: (quote.rawEstimate as { quote?: unknown }).quote as never,
          }),
      )
      finish(res)
    } catch (err) {
      const message = kitErrorMessage(err)
      setError(message)
      setSteps({})
      setPhase(message === null ? 'quoted' : 'error')
    }
  }, [address, amount, finish, from, phase, prepare, quote, speed, to, token, withProgress])

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
    setWarnings([])
    setError(null)
  }, [])

  return { phase, quote, steps, result, warnings, error, getQuote, execute, retry, reset, isConnected: !!address }
}
