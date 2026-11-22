import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import type { SwapEstimate } from '@circle-fin/app-kit'
import { ArrowDownUp, ExternalLink, Info } from 'lucide-react'
import { toast } from 'sonner'
import { getUsdc } from '@/onchain-facts'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { appKit, adapterFromConnector, kitErrorMessage } from '@/lib/appkit'
import { SiteBar } from '@/components/SiteBar'
import { AppLink } from '@/components/AppLink'
import { Button } from '@/components/ui'
import { ChainLogo, CoinLogo } from '@/components/logos'
import { RollingNumber } from '@/components/fx/RollingNumber'

const PCT_PRESETS = [
  { label: '25%', num: 25n },
  { label: '50%', num: 50n },
  { label: '75%', num: 75n },
  { label: 'MAX', num: 100n },
] as const

const TOKENS = ['USDC', 'EURC'] as const
type Token = (typeof TOKENS)[number]
const SLIPPAGE_OPTIONS = [50, 100, 300] as const

const rawEurc = (import.meta.env.VITE_ARC_TESTNET_EURC_ADDRESS as string | undefined)?.trim()
const TOKEN_ADDRESS: Record<Token, Address | undefined> = {
  USDC: getUsdc(arcTestnet.id)?.address as Address | undefined,
  EURC: rawEurc && /^0x[0-9a-fA-F]{40}$/.test(rawEurc) ? (rawEurc as Address) : undefined,
}

function useTokenBalance(token: Token) {
  const { address } = useAccount()
  const res = useReadContract({
    address: TOKEN_ADDRESS[token],
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
    chainId: arcTestnet.id,
    query: { enabled: !!address && !!TOKEN_ADDRESS[token], refetchInterval: 10_000 },
  })
  return res.data
}

type Reviewed = { key: string; estimate: SwapEstimate }
type Done = { amountOut?: string; tokenOut: Token; explorerUrl?: string; status: string }

const initial = () => {
  const q = new URLSearchParams(window.location.search)
  const t = q.get('tokenIn')
  const a = q.get('amount')
  return {
    tokenIn: (TOKENS as readonly string[]).includes(t ?? '') ? (t as Token) : 'USDC',
    amount: a && /^\d+(\.\d{1,6})?$/.test(a) ? a : '',
  }
}

export default function SwapPage() {
  const { address, isConnected, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [tokenIn, setTokenIn] = useState<Token>(() => initial().tokenIn)
  const [amount, setAmount] = useState(() => initial().amount)
  const [slippage, setSlippage] = useState<number>(100)
  const [reviewed, setReviewed] = useState<Reviewed | null>(null)
  const [busy, setBusy] = useState<'quote' | 'swap' | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flips, setFlips] = useState(0)

  const tokenOut: Token = tokenIn === 'USDC' ? 'EURC' : 'USDC'
  const balIn = useTokenBalance(tokenIn)
  const balOut = useTokenBalance(tokenOut)

  const amountRaw = useMemo(() => {
    try {
      return amount ? parseUsdc(amount) : 0n
    } catch {
      return 0n
    }
  }, [amount])

  const key = `${address}|${tokenIn}|${amount}|${slippage}`
  const isReviewed = reviewed?.key === key
  const insufficient = balIn !== undefined && amountRaw > balIn

  const prepare = async () => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== arcTestnet.id) await switchChainAsync({ chainId: arcTestnet.id })
    return adapterFromConnector(connector)
  }

  const review = async () => {
    setBusy('quote')
    setError(null)
    setDone(null)
    try {
      const adapter = await prepare()
      const estimate = await appKit.estimateSwap({
        from: { adapter, chain: 'Arc_Testnet' },
        tokenIn,
        tokenOut,
        amountIn: amount,
        config: { slippageBps: slippage },
      })
      setReviewed({ key, estimate })
    } catch (err) {
      setReviewed(null)
      setError(kitErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const swap = async () => {
    if (!isReviewed) return
    setBusy('swap')
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
      setError(kitErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const fmt = (v?: bigint) => (v === undefined ? '...' : formatUsdc(v))

  const applyPct = (num: bigint) => {
    if (balIn === undefined) return
    // On Arc, USDC is also the gas token: keep 1 USDC back for fees.
    const spendable = tokenIn === 'USDC' ? (balIn > 1_000_000n ? balIn - 1_000_000n : 0n) : balIn
    setAmount(formatUsdc((spendable * num) / 100n))
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteBar fixed />
      <div className="relative z-10 flex flex-1 w-full flex-col items-center justify-center overflow-hidden px-4 py-3 sm:py-4">

        <motion.section
          className="relative z-20 w-full max-w-[450px] rounded-[24px] p-4 backdrop-blur-2xl sm:rounded-[26px] sm:p-5"
          style={{
            background: 'color-mix(in srgb, var(--panel-solid) 95%, transparent)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 24px 80px -20px var(--accent-glow), 0 12px 40px -12px rgba(0,0,0,0.28)',
          }}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Top: You're swapping */}
          <div>
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--muted)' }}>
              <span>You&apos;re swapping</span>
              <span>Balance: {fmt(balIn)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setAmount(e.target.value)}
                placeholder="0.00"
                aria-label="Amount to swap"
                className="no-focus-ring display w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none sm:text-3xl"
              />
              <button
                type="button"
                onClick={() => {
                  setTokenIn(tokenOut)
                  setReviewed(null)
                  setFlips((n) => n + 1)
                }}
                aria-label="Switch swap token"
                className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition-transform hover:scale-[1.03] active:scale-[0.98]"
                style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)' }}
              >
                <CoinLogo symbol={tokenIn} size={18} />
                <span>{tokenIn}</span>
                <motion.span animate={{ rotate: flips * 180 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                  <ArrowDownUp className="size-3.5 opacity-70" />
                </motion.span>
              </button>
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

          {/* Middle: Protocol, Slippage, Fees */}
          <div className="mt-3.5 space-y-2 border-y py-3 text-xs" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--subtle)' }}>Network</span>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <ChainLogo chain="Arc_Testnet" size={16} />
                Arc Testnet
              </span>
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
                {(reviewed.estimate.fees ?? []).map((f, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="capitalize" style={{ color: 'var(--subtle)' }}>{f.type} fee</span>
                    <span className="font-medium tabular-nums">{f.amount ?? '0'} {f.token}</span>
                  </div>
                ))}
                <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed" style={{ color: 'var(--subtle)' }}>
                  <Info className="mt-0.5 size-3 shrink-0" />
                  Final output can vary within your slippage tolerance.
                </p>
              </>
            )}
          </div>

          {/* Bottom: To receive */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
              <span>To receive</span>
              <span>Balance: {fmt(balOut)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="display w-full min-w-0 truncate text-2xl font-bold tabular-nums sm:text-3xl" style={{ opacity: isReviewed ? 1 : 0.65 }}>
                <RollingNumber value={isReviewed ? String(reviewed.estimate.estimatedOutput.amount) : '0.00'} />
              </p>
              <span
                className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)' }}
              >
                <CoinLogo symbol={tokenOut} size={18} />
                <span>{tokenOut}</span>
              </span>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
          {insufficient && (
            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)' }}>
              Not enough {tokenIn}. Use &quot;Get test USDC&quot; in the Arc Studio sidebar.
            </p>
          )}

          {/* Primary Pill CTA */}
          <div className="mt-4">
            {!isConnected ? (
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <Button className="w-full rounded-full py-3 text-sm font-bold" onClick={show}>
                    Connect wallet
                  </Button>
                )}
              </ConnectKitButton.Custom>
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

        <p className="relative z-20 mt-3 text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          USDC is also the gas token on Arc. Keep some USDC in your wallet for transaction fees.
        </p>
        <div className="relative z-20 mt-1.5 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold">
          <AppLink to="/buy" className="underline hover:opacity-85" style={{ color: 'var(--accent)' }}>
            Buy USDC (sandbox)
          </AppLink>
          <span aria-hidden style={{ color: 'var(--subtle)' }}>
            •
          </span>
          <AppLink to="/p2p?mode=sell" className="underline hover:opacity-85" style={{ color: 'var(--muted)' }}>
            Cash out USDC
          </AppLink>
        </div>
      </div>
    </div>
  )
}
