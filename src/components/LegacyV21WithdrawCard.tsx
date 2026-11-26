import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { formatUnits, type Address } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID } from '@/lib/p2p'

const LEGACY_V21_USDC_ESCROW = '0xf719ebbc5080aee09e38909764b897e0bf01a9b0' as Address

function formatUsdc(amount: bigint): string {
  const n = Number(formatUnits(amount, 6))
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

interface LegacyAdItem {
  id: bigint
  available: bigint
}

interface LegacyFundsState {
  wallet: string
  ads: LegacyAdItem[]
  claimable: bigint
  margin: bigint
  pendingMargin: bigint
  pendingUnlockAt: bigint
  marginUnlocked: boolean
  ownerFees: bigint
  isOwner: boolean
}

const EMPTY_STATE: LegacyFundsState = {
  wallet: '',
  ads: [],
  claimable: 0n,
  margin: 0n,
  pendingMargin: 0n,
  pendingUnlockAt: 0n,
  marginUnlocked: false,
  ownerFees: 0n,
  isOwner: false,
}

async function fetchLegacyFunds(
  address: Address,
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
): Promise<LegacyFundsState> {
  const [allAds, claimable, margin, marginWd, ownerAddr, feesAccrued] = await Promise.all([
    publicClient.readContract({
      address: LEGACY_V21_USDC_ESCROW,
      abi: p2pEscrowAbi,
      functionName: 'getAds',
      args: [1n, 100n],
    }),
    publicClient.readContract({
      address: LEGACY_V21_USDC_ESCROW,
      abi: p2pEscrowAbi,
      functionName: 'claimable',
      args: [address],
    }),
    publicClient.readContract({
      address: LEGACY_V21_USDC_ESCROW,
      abi: p2pEscrowAbi,
      functionName: 'margin',
      args: [address],
    }),
    publicClient.readContract({
      address: LEGACY_V21_USDC_ESCROW,
      abi: p2pEscrowAbi,
      functionName: 'marginWithdrawal',
      args: [address],
    }),
    publicClient.readContract({
      address: LEGACY_V21_USDC_ESCROW,
      abi: p2pEscrowAbi,
      functionName: 'owner',
    }),
    publicClient.readContract({
      address: LEGACY_V21_USDC_ESCROW,
      abi: p2pEscrowAbi,
      functionName: 'feesAccrued',
    }),
  ])

  const me = address.toLowerCase()
  const openSellAds: LegacyAdItem[] = []
  allAds.forEach((ad, idx) => {
    if (ad.maker.toLowerCase() === me && ad.side === 0 && !ad.closed && ad.available > 0n) {
      openSellAds.push({ id: BigInt(idx + 1), available: ad.available })
    }
  })

  const isOwner = ownerAddr.toLowerCase() === me
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  return {
    wallet: me,
    ads: openSellAds,
    claimable,
    margin,
    pendingMargin: marginWd[0],
    pendingUnlockAt: marginWd[1],
    marginUnlocked: marginWd[0] > 0n && nowSec >= marginWd[1],
    ownerFees: isOwner ? feesAccrued : 0n,
    isOwner,
  }
}

export function LegacyV21WithdrawCard() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [fetched, setFetched] = useState<LegacyFundsState>(EMPTY_STATE)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!address || !publicClient) return
    try {
      const next = await fetchLegacyFunds(address, publicClient)
      setFetched(next)
    } catch {
      // Silently ignore if RPC is temporarily unreachable
    }
  }, [address, publicClient])

  useEffect(() => {
    if (!address || !publicClient) return
    let cancelled = false
    fetchLegacyFunds(address, publicClient)
      .then((next) => {
        if (!cancelled) setFetched(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [address, publicClient])

  const state = address && fetched.wallet === address.toLowerCase() ? fetched : EMPTY_STATE

  const totalAdsAmount = state.ads.reduce((sum, a) => sum + a.available, 0n)
  const totalRecoverable = totalAdsAmount + state.claimable + state.margin + state.ownerFees

  if (!address || totalRecoverable === 0n) return null

  const ensureArcChain = async () => {
    if (chainId !== CHAIN_ID) {
      await switchChainAsync({ chainId: CHAIN_ID })
    }
  }

  const runTx = async (
    key: string,
    label: string,
    fn:
      | { functionName: 'closeAd'; args: [bigint] }
      | { functionName: 'withdrawClaimable'; args?: undefined }
      | { functionName: 'requestMarginWithdrawal'; args: [bigint] }
      | { functionName: 'completeMarginWithdrawal'; args?: undefined }
      | { functionName: 'collectFees'; args?: undefined },
  ) => {
    if (!publicClient) return
    setBusyKey(key)
    try {
      await ensureArcChain()
      const hash = await writeContractAsync({
        address: LEGACY_V21_USDC_ESCROW,
        abi: p2pEscrowAbi,
        chainId: CHAIN_ID,
        ...fn,
      })
      toast.info(`${label} submitted…`)
      await publicClient.waitForTransactionReceipt({ hash })
      toast.success(`${label} completed! USDC returned to your wallet.`)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      toast.error(msg.includes('User rejected') ? 'Transaction cancelled' : msg.slice(0, 140))
    } finally {
      setBusyKey(null)
    }
  }

  const { marginUnlocked } = state

  return (
    <div className="mb-5 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Legacy v2.1 Escrow Funds Available to Withdraw
              </h3>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                {formatUsdc(totalRecoverable)} USDC
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              OnPeer upgraded to P2PEscrow v2.2. Your connected wallet still has funds locked on the
              previous v2.1 contract (<span className="font-mono">0xf719…a9b0</span>). Withdraw
              them directly to your wallet below.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {state.ads.map((ad) => {
          const key = `ad-${ad.id.toString()}`
          const busy = busyKey === key
          return (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5"
            >
              <div className="text-xs">
                <span className="font-mono font-semibold text-foreground">
                  v2.1 Sell Ad #{ad.id.toString()}
                </span>
                <span className="mx-2 text-muted-foreground">•</span>
                <span className="font-mono font-medium text-amber-300">
                  {formatUsdc(ad.available)} USDC
                </span>
              </div>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() =>
                  void runTx(key, `Close v2.1 Ad #${ad.id.toString()}`, {
                    functionName: 'closeAd',
                    args: [ad.id],
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                )}
                Close &amp; Withdraw
              </button>
            </div>
          )
        })}

        {state.claimable > 0n && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5">
            <div className="text-xs">
              <span className="font-semibold text-foreground">v2.1 Claimable Balance</span>
              <span className="mx-2 text-muted-foreground">•</span>
              <span className="font-mono font-medium text-amber-300">
                {formatUsdc(state.claimable)} USDC
              </span>
            </div>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void runTx('claimable', 'Withdraw v2.1 Claimable', {
                  functionName: 'withdrawClaimable',
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
            >
              {busyKey === 'claimable' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              Withdraw Claimable
            </button>
          </div>
        )}

        {state.margin > 0n && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5">
            <div className="text-xs">
              <span className="font-semibold text-foreground">v2.1 Merchant Margin</span>
              <span className="mx-2 text-muted-foreground">•</span>
              <span className="font-mono font-medium text-amber-300">
                {formatUsdc(state.margin)} USDC
              </span>
              {state.pendingMargin > 0n && !marginUnlocked && (
                <span className="ml-2 text-[11px] text-muted-foreground">
                  (Unlocks {new Date(Number(state.pendingUnlockAt) * 1000).toLocaleString()})
                </span>
              )}
            </div>
            {state.pendingMargin === 0n ? (
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() =>
                  void runTx('req-margin', 'Request v2.1 Margin Withdrawal', {
                    functionName: 'requestMarginWithdrawal',
                    args: [state.margin],
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busyKey === 'req-margin' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5" />
                )}
                Request 7d Unlock
              </button>
            ) : (
              <button
                type="button"
                disabled={busyKey !== null || !marginUnlocked}
                onClick={() =>
                  void runTx('complete-margin', 'Complete v2.1 Margin Withdrawal', {
                    functionName: 'completeMarginWithdrawal',
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busyKey === 'complete-margin' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                )}
                {marginUnlocked ? 'Complete Withdrawal' : 'Unlocking…'}
              </button>
            )}
          </div>
        )}

        {state.ownerFees > 0n && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5">
            <div className="text-xs">
              <span className="font-semibold text-foreground">v2.1 Accrued Listing Fees (Owner)</span>
              <span className="mx-2 text-muted-foreground">•</span>
              <span className="font-mono font-medium text-amber-300">
                {formatUsdc(state.ownerFees)} USDC
              </span>
            </div>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() =>
                void runTx('fees', 'Collect v2.1 Listing Fees', {
                  functionName: 'collectFees',
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
            >
              {busyKey === 'fees' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              Collect Fees
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
