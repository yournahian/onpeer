import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, type Address } from 'viem'
import type { BridgeEstimateResult, BridgeResult } from '@circle-fin/app-kit'
import { AlertTriangle, ArrowDownUp, Check, ChevronDown, ExternalLink, Info, Loader2, X } from 'lucide-react'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import { appKit, adapterFromConnector, kitErrorMessage } from '@/lib/appkit'
import {
  ALL_BRIDGE_EVENTS,
  BRIDGE_CHAINS,
  BRIDGE_TOKENS,
  BRIDGE_TOKEN_DECIMALS,
  bridgeStepLabel,
  bridgeStepOrderFor,
  getBridgeTokenAddress,
  toBridgeKitToken,
  type BridgeChainName,
  type BridgeToken,
  type BridgeTransferSpeed,
  type StepState,
} from '@/hooks/useBridgeFlow'
import { SiteBar } from '@/components/SiteBar'
import { Button } from '@/components/ui'
import { ChainLogo, CoinLogo } from '@/components/logos'

const PCT_PRESETS = [
  { label: '25%', num: 25n },
  { label: '50%', num: 50n },
  { label: '75%', num: 75n },
  { label: 'MAX', num: 100n },
] as const

type ChainOption = (typeof BRIDGE_CHAINS)[number]

type Quote = {
  key: string
  fees: { type: string; amount: string | null; token: string }[]
  gas: { name: string; fee: string; token: string }[]
  rawEstimate: BridgeEstimateResult
}

function normalizeBridgeToken(raw: string | null): BridgeToken {
  if (!raw) return 'USDC'
  const u = raw.trim().toUpperCase()
  if (u === 'EURC') return 'EURC'
  if (u === 'CIRBTC') return 'cirBTC'
  if (u === 'WETH') return 'WETH'
  return 'USDC'
}

const initial = () => {
  const q = new URLSearchParams(window.location.search)
  const names = BRIDGE_CHAINS.map((c) => c.kit) as string[]
  const token = normalizeBridgeToken(q.get('token'))
  const from = q.get('from')
  const to = q.get('to')
  const a = q.get('amount')
  const defaultDest: BridgeChainName = token === 'cirBTC' || token === 'WETH' ? 'Ethereum_Sepolia' : 'Base_Sepolia'
  const f = (names.includes(from ?? '') ? from : 'Arc_Testnet') as BridgeChainName
  let t = (names.includes(to ?? '') ? to : defaultDest) as BridgeChainName
  if (t === f) t = f === 'Arc_Testnet' ? defaultDest : 'Arc_Testnet'
  const maxDec = BRIDGE_TOKEN_DECIMALS[token]
  return {
    token,
    from: f,
    to: t,
    amount: a && new RegExp(`^\\d+(\\.\\d{1,${maxDec}})?$`).test(a) ? a : '',
  }
}

export default function BridgePage() {
  const { address, isConnected, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [token, setToken] = useState<BridgeToken>(() => initial().token)
  const [speed, setSpeed] = useState<BridgeTransferSpeed>('FAST')
  const [fromKit, setFromKit] = useState<BridgeChainName>(() => initial().from)
  const [toKit, setToKit] = useState<BridgeChainName>(() => initial().to)
  const [amount, setAmount] = useState(() => initial().amount)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [busy, setBusy] = useState<'quote' | 'bridge' | 'retry' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [result, setResult] = useState<BridgeResult<string> | null>(null)
  const [flips, setFlips] = useState(0)
  const adapterRef = useRef<Awaited<ReturnType<typeof adapterFromConnector>> | null>(null)

  const from: ChainOption = BRIDGE_CHAINS.find((c) => c.kit === fromKit) ?? BRIDGE_CHAINS[0]
  const to: ChainOption = BRIDGE_CHAINS.find((c) => c.kit === toKit) ?? BRIDGE_CHAINS[1]
  const decimals = BRIDGE_TOKEN_DECIMALS[token]
  const isCctpx = token !== 'USDC'

  const tokenAddress = getBridgeTokenAddress(token, fromKit)
  const balRes = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
    chainId: from.id,
    query: { enabled: !!address && !!tokenAddress, refetchInterval: 10_000 },
  })
  const balance = balRes.data

  const amountRaw = useMemo(() => {
    try {
      return amount ? parseUnitsExact(amount, decimals) : 0n
    } catch {
      return 0n
    }
  }, [amount, decimals])

  const key = `${address}|${token}|${speed}|${fromKit}|${toKit}|${amount}`
  const isQuoted = quote?.key === key
  const insufficient = balance !== undefined && amountRaw > balance
  const sameChain = fromKit === toKit

  // Real bridge progress: subscribe to both CCTP (burn/mint) and CCTPx (transfer/forward) events.
  useEffect(() => {
    const onStep = (name: string) => () => setSteps((s) => ({ ...s, [name]: 'done' }))
    const handlers = ALL_BRIDGE_EVENTS.map((name) => [name, onStep(name)] as const)
    for (const [name, h] of handlers) appKit.on(`bridge.${name}` as 'bridge.approve', h)
    return () => {
      for (const [name, h] of handlers) appKit.off(`bridge.${name}` as 'bridge.approve', h)
    }
  }, [])

  const selectToken = (next: BridgeToken) => {
    setToken(next)
    setAmount('')
    setQuote(null)
    setError(null)
    setWarnings([])
    setResult(null)
    setSteps({})
    // Nudge to a known CCTPx route if switching to cirBTC/WETH from an unrelated chain pair
    if (next === 'cirBTC' || next === 'WETH') {
      const validPair =
        (fromKit === 'Arc_Testnet' && toKit === 'Ethereum_Sepolia') ||
        (fromKit === 'Ethereum_Sepolia' && toKit === 'Arc_Testnet')
      if (!validPair) {
        if (fromKit === 'Ethereum_Sepolia') {
          setToKit('Arc_Testnet')
        } else {
          setFromKit('Arc_Testnet')
          setToKit('Ethereum_Sepolia')
        }
      }
    }
  }

  const flip = () => {
    setFlips((n) => n + 1)
    setFromKit(toKit)
    setToKit(fromKit)
    setQuote(null)
    setError(null)
  }

  const prepare = async () => {
    if (!connector) throw new Error('Wallet not connected')
    if (chainId !== from.id) await switchChainAsync({ chainId: from.id })
    const adapter = await adapterFromConnector(connector)
    adapterRef.current = adapter
    return adapter
  }

  const review = async () => {
    setBusy('quote')
    setError(null)
    setWarnings([])
    setResult(null)
    try {
      const adapter = await prepare()
      const est =
        token === 'USDC'
          ? await appKit.estimateBridge({
            from: { adapter, chain: fromKit },
            to: { adapter, chain: toKit, useForwarder: true },
            amount,
            token: 'USDC',
          })
          : await appKit.estimateBridge({
            from: { adapter, chain: fromKit },
            to: { adapter, chain: toKit },
            amount,
            token: toBridgeKitToken(token),
            config: { transferSpeed: speed },
          })
      setQuote({
        key,
        fees: est.fees.map((f) => ({ type: f.type, amount: f.amount, token: f.token })),
        gas: est.gasFees.filter((g) => g.fees).map((g) => ({ name: g.name, fee: g.fees!.fee, token: g.token })),
        rawEstimate: est,
      })
    } catch (err) {
      setQuote(null)
      setError(kitErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const bridge = async () => {
    if (!isQuoted || !quote) return
    setBusy('bridge')
    setError(null)
    setWarnings([])
    setResult(null)
    setSteps({ approve: 'running' })
    try {
      const adapter = await prepare()
      const res =
        token === 'USDC'
          ? await appKit.bridge({
            from: { adapter, chain: fromKit },
            to: { adapter, chain: toKit, useForwarder: true },
            amount,
            token: 'USDC',
          })
          : await appKit.bridge({
            from: { adapter, chain: fromKit },
            to: { adapter, chain: toKit },
            amount,
            token: toBridgeKitToken(token),
            config: { transferSpeed: speed },
            quote: (quote.rawEstimate as { quote?: unknown }).quote as never,
          })
      finish(res)
    } catch (err) {
      setError(kitErrorMessage(err))
      setSteps({})
    } finally {
      setBusy(null)
    }
  }

  const retry = async () => {
    if (!result || !adapterRef.current) return
    setBusy('retry')
    setError(null)
    try {
      const adapter = await prepare()
      const res = await appKit.retryBridge(result, { from: adapter, to: adapter })
      finish(res)
    } catch (err) {
      setError(kitErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const finish = (res: BridgeResult<string>) => {
    setResult(res)
    const resWarnings = ((res as { warnings?: { code?: string; message?: string }[] }).warnings ?? [])
      .map((w) => w.message || w.code || '')
      .filter(Boolean)
    setWarnings(resWarnings)
    const next: Record<string, StepState> = {}
    for (const s of res.steps) next[s.name] = s.state === 'success' ? 'done' : s.state === 'error' ? 'error' : 'idle'
    setSteps(next)
    if (res.state === 'success') {
      setAmount('')
      setQuote(null)
    }
  }

  const stepList = useMemo(() => result?.steps ?? [], [result])
  const orderedSteps = useMemo(() => {
    const baseOrder = [...bridgeStepOrderFor(token)]
    if (stepList.some((s) => s.name === 'approveFee') && !baseOrder.includes('approveFee')) {
      baseOrder.splice(1, 0, 'approveFee')
    }
    return baseOrder
  }, [token, stepList])
  const showProgress = busy === 'bridge' || result !== null

  const applyPct = (num: bigint) => {
    if (balance === undefined) return
    const spendable =
      token === 'USDC' && fromKit === 'Arc_Testnet'
        ? balance > 1_000_000n
          ? balance - 1_000_000n
          : 0n
        : balance
    setAmount(formatUnitsExact((spendable * num) / 100n, decimals))
    setQuote(null)
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteBar />
      <div className="relative z-10 flex flex-1 w-full flex-col items-center justify-center overflow-visible px-4 py-3 sm:py-4">
        <motion.section
          className="relative z-30 w-full max-w-[450px] rounded-[24px] p-4 backdrop-blur-2xl sm:rounded-[26px] sm:p-5"
          style={{
            background: 'color-mix(in srgb, var(--panel-solid) 95%, transparent)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 24px 80px -20px var(--accent-glow), 0 12px 40px -12px rgba(0,0,0,0.28)',
          }}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Top: You're bridging */}
          <div>
            <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--muted)' }}>
              <span>You&apos;re bridging</span>
              <span>
                {balance === undefined ? 'Balance unavailable' : `Balance: ${formatUnitsExact(balance, decimals)}`}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value
                  if (new RegExp(`^\\d*\\.?\\d{0,${decimals}}$`).test(val)) {
                    setAmount(val)
                    setQuote(null)
                  }
                }}
                placeholder="0.00"
                aria-label={`${token} amount to bridge`}
                className="no-focus-ring display w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none sm:text-3xl"
              />
              <BridgeTokenSelect value={token} onChange={selectToken} />
            </div>

            {/* 25% 50% 75% MAX pills */}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {PCT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={balance === undefined}
                  onClick={() => applyPct(p.num)}
                  className="rounded-full py-1 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)] disabled:opacity-50"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Middle: From, To, Protocol, Transfer Speed, Fees */}
          <div className="mt-3.5 space-y-2 border-y py-3 text-xs" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--subtle)' }}>From</span>
              <ChainSelect value={fromKit} onChange={(v) => { setFromKit(v); setQuote(null) }} exclude={toKit} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--subtle)' }}>To</span>
                <motion.button
                  type="button"
                  onClick={flip}
                  animate={{ rotate: flips * 180 }}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  aria-label="Swap source and destination"
                  className="flex size-5 items-center justify-center rounded-full border"
                  style={{ background: 'var(--fill-2)', borderColor: 'var(--border)' }}
                >
                  <ArrowDownUp className="size-3" />
                </motion.button>
              </div>
              <ChainSelect value={toKit} onChange={(v) => { setToKit(v); setQuote(null) }} exclude={fromKit} />
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--subtle)' }}>Protocol</span>
              <span className="font-semibold">{isCctpx ? 'Circle CCTPx' : 'Circle CCTP'}</span>
            </div>
            {isCctpx && (
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--subtle)' }}>Transfer speed</span>
                <div className="flex gap-1.5">
                  {(['FAST', 'SLOW'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setSpeed(mode)
                        setQuote(null)
                      }}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
                      style={
                        speed === mode
                          ? { background: 'var(--accent-bg)', color: 'var(--on-accent)' }
                          : { background: 'var(--fill-2)', color: 'var(--muted)' }
                      }
                    >
                      {mode === 'FAST' ? 'Fast' : 'Standard'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {isCctpx && (
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                {token === 'EURC'
                  ? 'Active testnet routes: Arc, Ethereum Sepolia, Base Sepolia & Avalanche Fuji.'
                  : `Active testnet route for ${token}: Ethereum Sepolia ↔ Arc Testnet.`}
              </p>
            )}
            {isQuoted && (
              <>
                {quote.fees.map((f, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="capitalize" style={{ color: 'var(--subtle)' }}>{f.type} fee</span>
                    <span className="font-medium tabular-nums">{f.amount ?? '0'} {f.token}</span>
                  </div>
                ))}
                {quote.gas.map((g, i) => (
                  <div key={`g${i}`} className="flex items-center justify-between">
                    <span style={{ color: 'var(--subtle)' }}>Gas ({g.name})</span>
                    <span className="font-medium tabular-nums">{g.fee} {g.token}</span>
                  </div>
                ))}
                <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed" style={{ color: 'var(--subtle)' }}>
                  <Info className="mt-0.5 size-3 shrink-0" />
                  Circle&apos;s relayer delivers {token} on {to.label}, so you only need gas on {from.label}.
                </p>
              </>
            )}
          </div>

          {/* Bottom: To receive */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
              <span>To receive</span>
              <span className="inline-flex items-center gap-1.5">
                On <ChainLogo chain={toKit} size={14} /> {to.label}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="display w-full min-w-0 truncate text-2xl font-bold tabular-nums sm:text-3xl" style={{ opacity: amount ? 1 : 0.65 }}>
                {amount || '0.00'}
              </p>
              <span
                className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)' }}
              >
                <CoinLogo symbol={token} size={18} />
                <span>{token}</span>
              </span>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="mt-3 flex items-start gap-1.5 text-xs font-medium" style={{ color: 'var(--warn)' }}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{warnings.join(' ')}</span>
            </div>
          )}
          {error && (
            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
          {insufficient && (
            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)' }}>
              Not enough {token} on {from.label}.
              {token === 'USDC' && fromKit === 'Arc_Testnet'
                ? ' Use "Get test USDC" in the Arc Studio sidebar.'
                : ''}
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
            ) : isQuoted ? (
              <Button
                className="w-full rounded-full py-3 text-sm font-bold"
                loading={busy === 'bridge'}
                disabled={busy !== null}
                onClick={() => void bridge()}
              >
                {busy === 'bridge' ? 'Bridging...' : `Bridge ${amount} ${token} to ${to.label}`}
              </Button>
            ) : (
              <Button
                className="w-full rounded-full py-3 text-sm font-bold"
                loading={busy === 'quote'}
                disabled={amountRaw === 0n || insufficient || sameChain || busy !== null}
                onClick={() => void review()}
              >
                Review bridge
              </Button>
            )}
          </div>
        </motion.section>

        {showProgress && (
          <motion.section
            className="glass relative z-10 mt-3 w-full max-w-[450px] space-y-2 rounded-2xl p-3.5"
            aria-live="polite"
            aria-label="Bridge progress"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {orderedSteps.map((name) => {
              const state: StepState =
                steps[name] ??
                (busy === 'bridge' && Object.keys(steps).length === 0 && name === 'approve' ? 'running' : 'idle')
              const real = stepList.find((s) => s.name === name)
              return (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <StepIcon state={state} />
                    {bridgeStepLabel(name, token)}
                  </span>
                  {real?.explorerUrl && (
                    <a
                      href={real.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      View <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              )
            })}
            {result?.state === 'success' && (
              <p className="pt-1 text-sm font-semibold" style={{ color: 'var(--success)' }}>
                Bridge complete. Your {token} is on {to.label}.
              </p>
            )}
            {result?.state === 'error' && (
              <div className="pt-1">
                <p className="text-sm" style={{ color: 'var(--danger)' }}>
                  The transfer stopped part-way. Your funds are safe: retry resumes from the failed step.
                </p>
                <Button
                  className="mt-2 w-full rounded-full"
                  variant="ghost"
                  loading={busy === 'retry'}
                  disabled={busy !== null}
                  onClick={() => void retry()}
                >
                  Retry from failed step
                </Button>
              </div>
            )}
          </motion.section>
        )}

        <p className="relative z-10 mt-3 text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          Fast transfers usually finish within a minute. Test tokens only: these networks are testnets.
        </p>
      </div>
    </div>
  )
}

function BridgeTokenSelect({
  value,
  onChange,
}: {
  value: BridgeToken
  onChange: (next: BridgeToken) => void
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
        aria-label="Select token to bridge"
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
            {BRIDGE_TOKENS.map((tok) => {
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

function ChainSelect({
  value,
  onChange,
  exclude,
}: {
  value: BridgeChainName
  onChange: (v: BridgeChainName) => void
  exclude: BridgeChainName
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = BRIDGE_CHAINS.find((c) => c.kit === value) ?? BRIDGE_CHAINS[0]
  const options = BRIDGE_CHAINS.filter((c) => c.kit !== exclude)

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
    <div ref={wrapRef} className={`relative ${open ? 'z-50' : 'z-10'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all hover:bg-[var(--fill-3)]"
        style={{
          background: 'var(--fill-2)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-strong)'}`,
          boxShadow: open ? '0 0 0 2px var(--accent-glow)' : undefined,
        }}
      >
        <ChainLogo chain={current.kit} size={16} />
        <span>{current.label}</span>
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
            className="absolute right-0 z-50 mt-2 w-56 max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl p-1.5"
            style={{
              backgroundColor: 'var(--panel-solid)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.88), 0 0 0 1px rgba(255, 90, 0, 0.25)',
            }}
          >
            {options.map((c) => {
              const selected = c.kit === value
              return (
                <li key={c.kit}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(c.kit)
                      setOpen(false)
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs font-bold transition-colors hover:bg-[var(--fill-3)]"
                    style={{
                      backgroundColor: selected ? 'var(--fill-3)' : 'transparent',
                      color: 'var(--ink)',
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <ChainLogo chain={c.kit} size={16} />
                      <span>{c.label}</span>
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

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check className="size-4" style={{ color: 'var(--success)' }} />
  if (state === 'error') return <X className="size-4" style={{ color: 'var(--danger)' }} />
  if (state === 'running') return <Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent)' }} />
  return <span className="size-4 rounded-full border" style={{ borderColor: 'var(--border-strong)' }} />
}
