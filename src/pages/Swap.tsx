import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, usePublicClient, useReadContract, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi'
import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import { erc20Abi, type Address } from 'viem'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ACTIVE_CHAIN_ID, ARC_KIT_CHAIN, ARC_NETWORK_LABEL, IS_TESTNET } from '@/lib/network'
import { ArrowDownUp, Check, ChevronDown, ExternalLink, Info, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import { appKit, adapterFromConnector, kitErrorMessage } from '@/lib/appkit'
import {
  AchSwapError,
  fetchAchSwapBuild,
  fetchAchSwapQuote,
  formatAchSwapFees,
  formatAchSwapRouteSummary,
  toAchSwapInput,
  toAchSwapOutput,
} from '@/lib/achswap'
import {
  SLIPPAGE_OPTIONS,
  SWAP_TOKENS,
  SWAP_TOKEN_ADDRESS,
  SWAP_TOKEN_DECIMALS,
  defaultSwapCounterpart,
  toSwapKitToken,
  type SwapToken,
} from '@/hooks/useSwapFlow'
import { SiteBar } from '@/components/SiteBar'
import { Button } from '@/components/ui'
import { ChainLogo, CoinLogo } from '@/components/logos'
import { RollingNumber } from '@/components/fx/RollingNumber'
import { useTheme } from '@/lib/theme'

const PCT_PRESETS = [
  { label: '25%', num: 25n },
  { label: '50%', num: 50n },
  { label: '75%', num: 75n },
  { label: 'MAX', num: 100n },
] as const

function useTokenBalance(token: SwapToken) {
  const { address } = useAccount()
  const tokenAddress = SWAP_TOKEN_ADDRESS[token]
  const res = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address && !!tokenAddress, refetchInterval: 10_000 },
  })
  return res.data
}

function normalizeSwapToken(raw: string | null): SwapToken | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (upper === 'USDC') return 'USDC'
  if (upper === 'EURC') return 'EURC'
  if (upper === 'CIRBTC') return 'cirBTC'
  if (upper === 'WETH') return 'WETH'
  return null
}

type NormalizedEstimate = {
  amountOut: string
  minAmountOut?: string
  priceImpactBps?: number | null
  routeSummary?: string | null
  provider: 'achswap' | 'swapkit'
  fees: Array<{ type: string; amount: string; token: string }>
}

type Reviewed = { key: string; estimate: NormalizedEstimate }
type Done = { amountOut?: string; tokenOut: SwapToken; explorerUrl?: string; status: string }

const initial = () => {
  const q = new URLSearchParams(window.location.search)
  const tIn = normalizeSwapToken(q.get('tokenIn')) ?? 'USDC'
  const rawOut = normalizeSwapToken(q.get('tokenOut'))
  const tOut = rawOut && rawOut !== tIn ? rawOut : defaultSwapCounterpart(tIn)
  const maxDec = SWAP_TOKEN_DECIMALS[tIn]
  const a = q.get('amount')
  return {
    tokenIn: tIn,
    tokenOut: tOut,
    amount: a && new RegExp(`^\\d+(\\.\\d{1,${maxDec}})?$`).test(a) ? a : '',
  }
}

export default function SwapPage() {
  const { address, isConnected, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID })
  const { helixBlurred, setHelixBlurred } = useTheme()
  const cardRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setHelixBlurred(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelixBlurred(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
      setHelixBlurred(false)
    }
  }, [setHelixBlurred])
  const [tokenIn, setTokenIn] = useState<SwapToken>(() => initial().tokenIn)
  const [tokenOut, setTokenOut] = useState<SwapToken>(() => initial().tokenOut)
  const [amount, setAmount] = useState(() => initial().amount)
  const [slippage, setSlippage] = useState<number>(100)
  const [reviewed, setReviewed] = useState<Reviewed | null>(null)
  const [busy, setBusy] = useState<'quote' | 'swap' | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flips, setFlips] = useState(0)

  const decimalsIn = SWAP_TOKEN_DECIMALS[tokenIn]
  const decimalsOut = SWAP_TOKEN_DECIMALS[tokenOut]
  const balIn = useTokenBalance(tokenIn)
  const balOut = useTokenBalance(tokenOut)

  const amountRaw = useMemo(() => {
    try {
      return amount ? parseUnitsExact(amount, decimalsIn) : 0n
    } catch {
      return 0n
    }
  }, [amount, decimalsIn])

  const key = `${address}|${tokenIn}|${tokenOut}|${amount}|${slippage}`
  const isReviewed = reviewed?.key === key
  const insufficient = balIn !== undefined && amountRaw > balIn

  const prepare = async () => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== ACTIVE_CHAIN_ID) await switchChainAsync({ chainId: ACTIVE_CHAIN_ID })
    return adapterFromConnector(connector)
  }

  const review = async () => {
    setBusy('quote')
    setError(null)
    setDone(null)
    try {
      if (!IS_TESTNET) {
        const { tokenIn: achIn, amountIn: achAmount } = toAchSwapInput(tokenIn, SWAP_TOKEN_ADDRESS[tokenIn], amountRaw)
        const achOut = toAchSwapOutput(tokenOut, SWAP_TOKEN_ADDRESS[tokenOut])
        const q = await fetchAchSwapQuote({
          tokenIn: achIn,
          tokenOut: achOut,
          amountIn: achAmount,
          slippageBps: slippage,
        })
        setReviewed({
          key,
          estimate: {
            amountOut: formatUnitsExact(BigInt(q.amountOut), decimalsOut),
            minAmountOut: formatUnitsExact(BigInt(q.minAmountOut), decimalsOut),
            priceImpactBps: q.priceImpactBps,
            routeSummary: formatAchSwapRouteSummary(q.route),
            provider: 'achswap',
            fees: formatAchSwapFees(q.fees, tokenOut, decimalsOut),
          },
        })
        return
      }

      const adapter = await prepare()
      const estimate = await appKit.estimateSwap({
        from: { adapter, chain: ARC_KIT_CHAIN },
        tokenIn: toSwapKitToken(tokenIn),
        tokenOut: toSwapKitToken(tokenOut),
        amountIn: amount,
        config: { slippageBps: slippage },
      })
      setReviewed({
        key,
        estimate: {
          amountOut: String(estimate.estimatedOutput.amount),
          provider: 'swapkit',
          fees: (estimate.fees ?? []).map((f) => ({
            type: f.type,
            amount: String(f.amount ?? '0'),
            token: f.token,
          })),
        },
      })
    } catch (err) {
      setReviewed(null)
      setError(err instanceof AchSwapError ? err.message : kitErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const swap = async () => {
    if (!isReviewed) return
    setBusy('swap')
    setError(null)
    try {
      if (!IS_TESTNET) {
        if (!address) throw new Error('Wallet not connected')
        if (chainId !== ACTIVE_CHAIN_ID) await switchChainAsync({ chainId: ACTIVE_CHAIN_ID })
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
          const currentAllowance = publicClient
            ? await publicClient.readContract({
                address: built.approval.token,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [address, built.approval.spender],
              })
            : 0n
          const needed = BigInt(built.approval.amount)
          if (currentAllowance < needed) {
            toast.info(`Approve ${tokenIn} spending in your wallet...`)
            const approveHash = await writeContractAsync({
              address: built.approval.token,
              abi: erc20Abi,
              functionName: 'approve',
              args: [built.approval.spender, needed],
              chainId: ACTIVE_CHAIN_ID,
            })
            if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash })
          }
        }
        const txHash = await sendTransactionAsync({
          to: built.tx.to,
          data: built.tx.data,
          value: BigInt(built.tx.value || '0'),
          gas: built.tx.gas ? BigInt(built.tx.gas) : undefined,
          chainId: ACTIVE_CHAIN_ID,
        })
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: txHash })
        setDone({
          amountOut: formatUnitsExact(BigInt(built.amountOut), decimalsOut),
          tokenOut,
          explorerUrl: buildTxExplorerUrl(ACTIVE_CHAIN_ID, txHash),
          status: 'DONE',
        })
        setReviewed(null)
        setAmount('')
        toast.success('Swap completed')
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
      setDone({
        amountOut: result.amountOut,
        tokenOut,
        explorerUrl: result.explorerUrl,
        status: result.progress.status,
      })
      setReviewed(null)
      setAmount('')
      toast.success('Swap submitted')
    } catch (err) {
      setError(err instanceof AchSwapError ? err.message : kitErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const fmt = (v: bigint | undefined, dec: number) => (v === undefined ? '...' : formatUnitsExact(v, dec))

  const applyPct = (num: bigint) => {
    if (balIn === undefined) return
    // On Arc, USDC is also the gas token: keep 1 USDC back for fees.
    const spendable = tokenIn === 'USDC' ? (balIn > 1_000_000n ? balIn - 1_000_000n : 0n) : balIn
    setAmount(formatUnitsExact((spendable * num) / 100n, decimalsIn))
    setReviewed(null)
  }

  const handleSelectIn = (next: SwapToken) => {
    if (next === tokenOut) {
      setTokenOut(tokenIn)
    }
    setTokenIn(next)
    setAmount('')
    setReviewed(null)
    setError(null)
  }

  const handleSelectOut = (next: SwapToken) => {
    if (next === tokenIn) {
      setTokenIn(tokenOut)
    }
    setTokenOut(next)
    setReviewed(null)
    setError(null)
  }

  const flipPair = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmount('')
    setReviewed(null)
    setError(null)
    setFlips((n) => n + 1)
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteBar />
      <div className="relative z-10 flex flex-1 w-full flex-col items-center justify-center overflow-visible px-4 py-3 sm:py-4">
        <motion.section
          ref={cardRef}
          onPointerDown={() => setHelixBlurred(true)}
          onFocusCapture={() => setHelixBlurred(true)}
          className="relative z-30 w-full max-w-[450px] rounded-[24px] p-4 backdrop-blur-2xl transition-shadow duration-300 sm:rounded-[26px] sm:p-5"
          style={{
            background: 'color-mix(in srgb, var(--panel-solid) 95%, transparent)',
            border: '1px solid var(--border-strong)',
            boxShadow: helixBlurred
              ? '0 28px 90px -16px var(--accent-glow), 0 16px 48px -12px rgba(0,0,0,0.45)'
              : '0 24px 80px -20px var(--accent-glow), 0 12px 40px -12px rgba(0,0,0,0.28)',
          }}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Top: You're swapping */}
          <div>
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--muted)' }}>
              <span>You&apos;re swapping</span>
              <span>Balance: {fmt(balIn, decimalsIn)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value
                  if (new RegExp(`^\\d*\\.?\\d{0,${decimalsIn}}$`).test(val)) {
                    setAmount(val)
                    setReviewed(null)
                  }
                }}
                placeholder="0.00"
                aria-label="Amount to swap"
                className="no-focus-ring display w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none sm:text-3xl"
              />
              <SwapTokenSelect value={tokenIn} onChange={handleSelectIn} label="Select input token" />
            </div>

            {/* 25% 50% 75% MAX pills */}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {PCT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={balIn === undefined}
                  onClick={() => applyPct(p.num)}
                  className="rounded-full py-1 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)] disabled:opacity-50"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Middle: Flip + Protocol, Slippage, Fees */}
          <div className="relative mt-3.5 space-y-2 border-y py-3 text-xs" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--subtle)' }}>Network</span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <ChainLogo chain={ARC_KIT_CHAIN} size={16} />
                  {ARC_NETWORK_LABEL}
                </span>
                <motion.button
                  type="button"
                  onClick={flipPair}
                  animate={{ rotate: flips * 180 }}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  aria-label="Switch swap direction"
                  title="Flip direction"
                  className="flex size-6 items-center justify-center rounded-full border"
                  style={{ background: 'var(--fill-2)', borderColor: 'var(--border-strong)' }}
                >
                  <ArrowDownUp className="size-3.5" />
                </motion.button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--subtle)' }}>Max slippage</span>
              <div className="flex gap-1.5">
                {SLIPPAGE_OPTIONS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => {
                      setSlippage(bps)
                      setReviewed(null)
                    }}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
                    style={
                      slippage === bps
                        ? { background: 'var(--accent-bg)', color: 'var(--on-accent)' }
                        : { background: 'var(--fill-2)', color: 'var(--muted)' }
                    }
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>
            {isReviewed && (
              <>
                <div className="flex items-center justify-between pt-0.5">
                  <span style={{ color: 'var(--subtle)' }}>Live quote</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void review()}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                  >
                    <RefreshCw className={`size-3 ${busy === 'quote' ? 'animate-spin' : ''}`} />
                    {busy === 'quote' ? 'Refreshing...' : 'Refresh quote'}
                  </button>
                </div>
                {reviewed.estimate.minAmountOut && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--subtle)' }}>Min received</span>
                    <span className="font-medium tabular-nums">
                      {reviewed.estimate.minAmountOut} {tokenOut}
                    </span>
                  </div>
                )}
                {reviewed.estimate.routeSummary && (
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ color: 'var(--subtle)' }}>Route</span>
                    <span className="truncate font-medium">{reviewed.estimate.routeSummary}</span>
                  </div>
                )}
                {reviewed.estimate.priceImpactBps !== undefined && reviewed.estimate.priceImpactBps !== null && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--subtle)' }}>Price impact</span>
                    <span className="font-medium tabular-nums">
                      {(reviewed.estimate.priceImpactBps / 100).toFixed(2)}%
                    </span>
                  </div>
                )}
                {(reviewed.estimate.fees ?? []).map((f, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="capitalize" style={{ color: 'var(--subtle)' }}>
                      {f.type} fee
                    </span>
                    <span className="font-medium tabular-nums">
                      {f.amount ?? '0'} {f.token}
                    </span>
                  </div>
                ))}
                <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed" style={{ color: 'var(--subtle)' }}>
                  <Info className="mt-0.5 size-3 shrink-0" />
                  {reviewed.estimate.provider === 'achswap'
                    ? 'Routed via AchSwap DEX aggregator on Arc. Final output can vary within your slippage tolerance.'
                    : 'Routed via Circle Swap aggregator subject to provider terms. Final output can vary within your slippage tolerance.'}
                </p>
              </>
            )}
          </div>

          {/* Bottom: To receive */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
              <span>To receive</span>
              <span>Balance: {fmt(balOut, decimalsOut)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="display w-full min-w-0 truncate text-2xl font-bold tabular-nums sm:text-3xl" style={{ opacity: isReviewed ? 1 : 0.65 }}>
                <RollingNumber value={isReviewed ? reviewed.estimate.amountOut : '0.00'} />
              </p>
              <SwapTokenSelect value={tokenOut} onChange={handleSelectOut} label="Select output token" />
            </div>
          </div>

          {error && (
            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
          {insufficient && (
            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)' }}>
              Not enough {tokenIn}.
            </p>
          )}

          {/* Primary Pill CTA */}
          <div className="mt-4">
            {!isConnected ? (
              <ConnectWalletCustom>
                {({ show }) => (
                  <Button className="w-full rounded-full py-3 text-sm font-bold" onClick={show}>
                    Connect wallet
                  </Button>
                )}
              </ConnectWalletCustom>
            ) : isReviewed ? (
              <Button
                className="w-full rounded-full py-3 text-sm font-bold"
                loading={busy === 'swap'}
                disabled={busy !== null}
                onClick={() => void swap()}
              >
                {busy === 'swap' ? 'Confirm in wallet...' : `Swap ${amount} ${tokenIn} to ${tokenOut}`}
              </Button>
            ) : (
              <Button
                className="w-full rounded-full py-3 text-sm font-bold"
                loading={busy === 'quote'}
                disabled={amountRaw === 0n || insufficient || busy !== null}
                onClick={() => void review()}
              >
                Review quote
              </Button>
            )}
          </div>
        </motion.section>

        {done && (
          <motion.section
            className="glass relative z-10 mt-3 w-full max-w-[450px] rounded-2xl p-3.5 text-sm"
            aria-live="polite"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <p className="font-semibold" style={{ color: 'var(--success)' }}>
              Swap {done.status === 'DONE' ? 'completed' : 'submitted'}
              {done.amountOut ? `: received ${done.amountOut} ${done.tokenOut}` : ''}
            </p>
            {done.explorerUrl && (
              <a
                href={done.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                View on explorer <ExternalLink className="size-3" />
              </a>
            )}
          </motion.section>
        )}

        <p className="relative z-10 mt-3 text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          USDC is also the gas token on Arc. Keep some USDC in your wallet for transaction fees.
        </p>
      </div>
    </div>
  )
}

function SwapTokenSelect({
  value,
  onChange,
  label,
}: {
  value: SwapToken
  onChange: (next: SwapToken) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${open ? 'z-50' : 'z-10'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition-all hover:bg-[var(--fill-3)]"
        style={{
          background: 'var(--fill-2)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-strong)'}`,
        }}
      >
        <CoinLogo symbol={value} size={18} />
        <span>{value}</span>
        <ChevronDown className={`size-3.5 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-2xl p-1.5"
            style={{
              backgroundColor: 'var(--panel-solid)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.88), 0 0 0 1px rgba(255, 90, 0, 0.25)',
            }}
          >
            {SWAP_TOKENS.map((tok) => {
              const selected = tok === value
              return (
                <li key={tok}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(tok)
                      setOpen(false)
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs font-bold transition-colors hover:bg-[var(--fill-3)]"
                    style={{
                      backgroundColor: selected ? 'var(--fill-3)' : 'transparent',
                      color: 'var(--ink)',
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <CoinLogo symbol={tok} size={18} />
                      <span>{tok}</span>
                    </span>
                    {selected && <Check className="size-3.5" style={{ color: 'var(--accent)' }} />}
                  </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
