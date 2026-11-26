import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { formatUnits, type Address } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { IS_TESTNET } from '@/lib/network'
import { CHAIN_ID } from '@/lib/p2p'

const LEGACY_ESCROWS: readonly { version: 'v2.2' | 'v2.1'; address: Address; short: string }[] = [
  { version: 'v2.2', address: '0x1929e33D2866d06E547eb02A1DDFcAc6bA2304fE', short: '0x1929…04fE' },
  { version: 'v2.1', address: '0xf719ebbc5080aee09e38909764b897e0bf01a9b0', short: '0xf719…a9b0' },
]

function formatUsdc(amount: bigint): string {
  const n = Number(formatUnits(amount, 6))
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

interface LegacyAdItem {
  version: 'v2.2' | 'v2.1'
  escrow: Address
  id: bigint
  available: bigint
}

interface LegacyContractSlice {
  version: 'v2.2' | 'v2.1'
  escrow: Address
  short: string
  ads: LegacyAdItem[]
  claimable: bigint
  margin: bigint
  pendingMargin: bigint
  pendingUnlockAt: bigint
  marginUnlocked: boolean
  ownerFees: bigint
}

interface LegacyFundsState {
  wallet: string
  slices: LegacyContractSlice[]
}

const EMPTY_STATE: LegacyFundsState = {
  wallet: '',
  slices: [],
}

async function fetchContractSlice(
  meta: (typeof LEGACY_ESCROWS)[number],
  address: Address,
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
): Promise<LegacyContractSlice> {
  const [userAdIds, claimable, margin, marginWd, ownerAddr, feesAccrued] = await Promise.all([
    publicClient.readContract({
      address: meta.address,
      abi: p2pEscrowAbi,
      functionName: 'getUserAdIds',
      args: [address],
    }),
    publicClient.readContract({
      address: meta.address,
      abi: p2pEscrowAbi,
      functionName: 'claimable',
      args: [address],
    }),
    publicClient.readContract({
      address: meta.address,
      abi: p2pEscrowAbi,
      functionName: 'margin',
      args: [address],
    }),
    publicClient.readContract({
      address: meta.address,
      abi: p2pEscrowAbi,
      functionName: 'marginWithdrawal',
      args: [address],
    }),
    publicClient.readContract({
      address: meta.address,
      abi: p2pEscrowAbi,
      functionName: 'owner',
    }),
    publicClient.readContract({
      address: meta.address,
      abi: p2pEscrowAbi,
      functionName: 'feesAccrued',
    }),
  ])

  const adDetails = await Promise.all(
    userAdIds.map((id) =>
      publicClient.readContract({
        address: meta.address,
        abi: p2pEscrowAbi,
        functionName: 'getAd',
        args: [id],
      }),
    ),
  )

  const openSellAds: LegacyAdItem[] = []
  adDetails.forEach((ad, idx) => {
    if (ad.side === 0 && !ad.closed && ad.available > 0n) {
      openSellAds.push({
        version: meta.version,
        escrow: meta.address,
        id: userAdIds[idx],
        available: ad.available,
      })
    }
  })

  const me = address.toLowerCase()
  const isOwner = ownerAddr.toLowerCase() === me
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  return {
    version: meta.version,
    escrow: meta.address,
    short: meta.short,
    ads: openSellAds,
    claimable,
    margin,
    pendingMargin: marginWd[0],
    pendingUnlockAt: marginWd[1],
    marginUnlocked: marginWd[0] > 0n && nowSec >= marginWd[1],
    ownerFees: isOwner ? feesAccrued : 0n,
  }
}

async function fetchLegacyFunds(
  address: Address,
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
): Promise<LegacyFundsState> {
  const slices = await Promise.all(
    LEGACY_ESCROWS.map((meta) => fetchContractSlice(meta, address, publicClient)),
  )
  return { wallet: address.toLowerCase(), slices }
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
      /* ignore transient RPC errors */
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

  const slices = address && fetched.wallet === address.toLowerCase() ? fetched.slices : []
  const totalRecoverable = slices.reduce(
    (sum, sl) =>
      sum +
      sl.ads.reduce((aSum, a) => aSum + a.available, 0n) +
      sl.claimable +
      sl.margin +
      sl.ownerFees,
    0n,
  )

  if (!IS_TESTNET || !address || totalRecoverable === 0n) return null

  const ensureArcChain = async () => {
    if (chainId !== CHAIN_ID) {
      await switchChainAsync({ chainId: CHAIN_ID })
    }
  }

  const runTx = async (
    key: string,
    escrow: Address,
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
        address: escrow,
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

  return (
    <div className="mb-5 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Legacy Escrow Funds Available to Withdraw
            </h3>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
              {formatUsdc(totalRecoverable)} USDC
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            OnPeer upgraded to P2PEscrow v2.3. Your connected wallet still has funds on a previous
            escrow contract (v2.1 / v2.2). Withdraw them directly to your wallet below.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {slices.map((sl) => (
          <div key={sl.version} className="flex flex-col gap-2">
            {sl.ads.map((ad) => {
              const key = `${sl.version}-ad-${ad.id.toString()}`
              const busy = busyKey === key
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5"
                >
                  <div className="text-xs">
                    <span className="font-mono font-semibold text-foreground">
                      {sl.version} Sell Ad #{ad.id.toString()}
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
                      void runTx(key, sl.escrow, `Close ${sl.version} Ad #${ad.id.toString()}`, {
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

            {sl.claimable > 0n && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5">
                <div className="text-xs">
                  <span className="font-semibold text-foreground">
                    {sl.version} Claimable Balance
                  </span>
                  <span className="mx-2 text-muted-foreground">•</span>
                  <span className="font-mono font-medium text-amber-300">
                    {formatUsdc(sl.claimable)} USDC
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() =>
                    void runTx(`${sl.version}-claimable`, sl.escrow, `Withdraw ${sl.version} Claimable`, {
                      functionName: 'withdrawClaimable',
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {busyKey === `${sl.version}-claimable` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  )}
                  Withdraw Claimable
                </button>
              </div>
            )}

            {sl.margin > 0n && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5">
                <div className="text-xs">
                  <span className="font-semibold text-foreground">
                    {sl.version} Merchant Margin ({sl.short})
                  </span>
                  <span className="mx-2 text-muted-foreground">•</span>
                  <span className="font-mono font-medium text-amber-300">
                    {formatUsdc(sl.margin)} USDC
                  </span>
                  {sl.pendingMargin > 0n && !sl.marginUnlocked && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      (Unlocks {new Date(Number(sl.pendingUnlockAt) * 1000).toLocaleString()})
                    </span>
                  )}
                </div>
                {sl.pendingMargin === 0n ? (
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() =>
                      void runTx(
                        `${sl.version}-req-margin`,
                        sl.escrow,
                        `Request ${sl.version} Margin Withdrawal`,
                        { functionName: 'requestMarginWithdrawal', args: [sl.margin] },
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    {busyKey === `${sl.version}-req-margin` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    Request 7d Unlock
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyKey !== null || !sl.marginUnlocked}
                    onClick={() =>
                      void runTx(
                        `${sl.version}-complete-margin`,
                        sl.escrow,
                        `Complete ${sl.version} Margin Withdrawal`,
                        { functionName: 'completeMarginWithdrawal' },
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    {busyKey === `${sl.version}-complete-margin` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                    )}
                    {sl.marginUnlocked ? 'Complete Withdrawal' : 'Unlocking…'}
                  </button>
                )}
              </div>
            )}

            {sl.ownerFees > 0n && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3.5 py-2.5">
                <div className="text-xs">
                  <span className="font-semibold text-foreground">
                    {sl.version} Accrued Listing Fees (Owner)
                  </span>
                  <span className="mx-2 text-muted-foreground">•</span>
                  <span className="font-mono font-medium text-amber-300">
                    {formatUsdc(sl.ownerFees)} USDC
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() =>
                    void runTx(`${sl.version}-fees`, sl.escrow, `Collect ${sl.version} Listing Fees`, {
                      functionName: 'collectFees',
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {busyKey === `${sl.version}-fees` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  )}
                  Collect Fees
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
