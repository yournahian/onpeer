import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Briefcase, ChevronDown, Clock, Gavel, History, KeyRound, Loader2, Lock, ShieldAlert, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  BACKUP_ARBITER_DELAY_SECONDS,
  CHAIN_ID,
  STATUS,
  STATUS_META,
  ZERO_BYTES32,
  countryByCurrency,
  formatDuration,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  getEscrowConfig,
  hexToCurrency,
  sameAddr,
  shortAddr,
  type P2pAsset,
} from '@/lib/p2p'
import { BackendApiError } from '@/lib/api'
import { useAccounts, useNow, type Account, type OrderWithId } from '@/hooks/useEscrow'
import { useP2pAccount } from '@/hooks/useAccount'
import { useOrderVault } from '@/hooks/useVault'
import { useTx } from '@/hooks/useTx'
import { Avatar, Button, CopyButton, StatusBadge } from '@/components/ui'
import { OrderChat } from '@/components/OrderChat'
import { CountryFlag } from '@/components/logos'

const PAID_WAIT_SECONDS = 15 * 60

export interface AdminPartyProfile {
  wallet: string
  displayName: string | null
  kycLegalName: string | null
  country: string | null
  kycStatus: string
  kycLevel: number
  disputesFiled: number
  createdAt: string | null
}

function PartyRow({
  role,
  address,
  account,
  profile,
  partyOrders,
  currentOrderId,
  asset,
}: {
  role: string
  address: string
  account?: Account
  profile?: AdminPartyProfile
  partyOrders: OrderWithId[]
  currentOrderId: bigint
  asset: P2pAsset
}) {
  const [showHistory, setShowHistory] = useState(false)

  const summary = useMemo(() => {
    let won = 0
    let lost = 0
    let disputes = 0
    let completed = 0
    for (const o of partyOrders) {
      const isBuyer = sameAddr(o.buyer, address)
      if (o.status === STATUS.COMPLETED) completed += 1
      if (
        o.status === STATUS.DISPUTED ||
        o.status === STATUS.RESOLVED_BUYER ||
        o.status === STATUS.RESOLVED_SELLER ||
        o.status === STATUS.SETTLED
      ) {
        disputes += 1
      }
      if ((o.status === STATUS.RESOLVED_BUYER && isBuyer) || (o.status === STATUS.RESOLVED_SELLER && !isBuyer)) {
        won += 1
      }
      if ((o.status === STATUS.RESOLVED_BUYER && !isBuyer) || (o.status === STATUS.RESOLVED_SELLER && isBuyer)) {
        lost += 1
      }
    }
    return {
      total: partyOrders.length,
      completed: Math.max(account?.ordersCompleted ?? 0, completed),
      disputes: Math.max(disputes, profile?.disputesFiled ?? 0),
      won,
      lost: Math.max(account?.disputesLost ?? 0, lost),
    }
  }, [partyOrders, address, account, profile])

  const kycOk = profile?.kycStatus === 'approved'
  const primaryName = profile?.kycLegalName || profile?.displayName || shortAddr(address)

  return (
    <div className="inner rounded-xl p-3">
      <div className="flex items-start gap-3">
        <Avatar address={address} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--fill-3)', color: 'var(--muted)' }}>
              {role}
            </span>
            <span className="truncate font-bold">{primaryName}</span>
            {profile?.kycLegalName && profile.displayName && profile.kycLegalName !== profile.displayName && (
              <span className="text-xs font-normal" style={{ color: 'var(--subtle)' }}>
                ({profile.displayName})
              </span>
            )}
            <span className="mono text-[11px] font-normal" style={{ color: 'var(--subtle)' }}>
              {shortAddr(address)}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'var(--fill-3)', color: kycOk ? 'var(--success)' : 'var(--subtle)' }}
            >
              <UserCheck className="size-2.5" />
              {kycOk ? `KYC L${profile?.kycLevel || 2}` : 'Unverified'}
            </span>
            {account?.merchant && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
                MERCHANT
              </span>
            )}
          </div>
          <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            {account
              ? `${summary.completed} completed (${summary.total} orders) · ${summary.disputes} disputes (${summary.won}W / ${summary.lost}L) · ${account.concessions} conc · ${account.strikes}/3 strikes · margin ${formatUsdcAmount(account.effectiveMargin, undefined, asset)} ${asset}${account.totalDebt > 0n ? ` · debt ${formatUsdcAmount(account.totalDebt, undefined, asset)} ${asset}` : ''}`
              : 'Loading profile...'}
          </p>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors hover:bg-[var(--fill-3)]"
              style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
            >
              <History className="size-3" />
              <span>{showHistory ? 'Hide' : 'View'} {role} History ({partyOrders.length} orders)</span>
              <ChevronDown className={`size-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="mt-2.5 max-h-48 overflow-y-auto rounded-lg border text-[11px]" style={{ borderColor: 'var(--border)' }}>
          {partyOrders.length === 0 ? (
            <p className="p-2.5 text-center" style={{ color: 'var(--subtle)' }}>
              No order history found.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {partyOrders.slice(0, 25).map((o) => {
                const isBuyer = sameAddr(o.buyer, address)
                const isCurrent = o.id === currentOrderId
                const meta = STATUS_META[o.status] ?? { label: 'Unknown', tone: 'neutral' }
                const cur = hexToCurrency(o.currency)
                const outcome =
                  o.status === STATUS.RESOLVED_BUYER
                    ? isBuyer
                      ? 'Won'
                      : 'Lost'
                    : o.status === STATUS.RESOLVED_SELLER
                      ? isBuyer
                        ? 'Lost'
                        : 'Won'
                      : null
                return (
                  <li
                    key={o.id.toString()}
                    className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5"
                    style={isCurrent ? { background: 'var(--fill-2)' } : undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="mono font-bold">
                        #{o.rawId.toString()} ({o.asset})
                      </span>
                      {isCurrent && (
                        <span className="rounded px-1 text-[9px] font-bold" style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}>
                          THIS CASE
                        </span>
                      )}
                      <span style={{ color: 'var(--subtle)' }}>{isBuyer ? 'Buyer' : 'Seller'}</span>
                      <span className="mono tabular-nums">
                        {formatUsdcAmount(o.amount, undefined, o.asset)} {o.asset} ({formatFiat(o.fiatAmountE6)} {cur})
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <span style={{ color: 'var(--muted)' }}>{meta.label}</span>
                      {outcome && (
                        <span
                          className="font-bold"
                          style={{ color: outcome === 'Won' ? 'var(--success)' : 'var(--danger)' }}
                        >
                          ({outcome})
                        </span>
                      )}
                      <span style={{ color: 'var(--subtle)' }}>
                        {new Date(Number(o.createdAt) * 1000).toLocaleDateString()}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function DisputeCard({
  order,
  accounts,
  allOrders = [],
  profiles,
  isPrimaryArbiter,
  isBackupArbiter,
  viewer,
}: {
  order: OrderWithId
  accounts: Map<string, Account>
  allOrders?: OrderWithId[]
  profiles?: Map<string, AdminPartyProfile>
  isPrimaryArbiter: boolean
  isBackupArbiter: boolean
  viewer?: string
}) {
  const now = useNow()
  const asset = order.asset
  const escrowAddress = getEscrowConfig(asset).escrowAddress
  const { run, writeContractAsync, pendingKey } = useTx(asset)
  const [open, setOpen] = useState(false)
  const [toBuyer, setToBuyer] = useState<boolean | null>(null)
  const [applyBond, setApplyBond] = useState(true)
  const [slash, setSlash] = useState(false)
  const [reviewed, setReviewed] = useState(false)

  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const anchor = order.disputedAt > 0n ? Number(order.disputedAt) : Number(order.paidAt)
  const age = Math.max(0, now - anchor)
  const stale = age > 24 * 3600
  const paidWaitLeft = order.disputedAt > 0n ? 0 : Number(order.paidAt) + PAID_WAIT_SECONDS - now
  const paidReady = paidWaitLeft <= 0
  const backupRemaining = BACKUP_ARBITER_DELAY_SECONDS - age
  const backupReady = backupRemaining <= 0
  const canRule = paidReady && (isPrimaryArbiter || (isBackupArbiter && backupReady))
  const inReview = order.reviewStartedAt > 0n

  const assetAccounts = useAccounts([order.buyer, order.seller], asset)
  const buyerAcc = assetAccounts.get(order.buyer.toLowerCase()) ?? accounts.get(order.buyer.toLowerCase())
  const sellerAcc = assetAccounts.get(order.seller.toLowerCase()) ?? accounts.get(order.seller.toLowerCase())
  const isParty = sameAddr(viewer, order.buyer) || sameAddr(viewer, order.seller)
  const { isSignedIn, signIn, signingIn } = useP2pAccount()
  const hasSealedHashes = order.detailsHash !== ZERO_BYTES32 || order.payerProof !== ZERO_BYTES32
  const canReadVault = open && !isParty && canRule
  const vaultQuery = useOrderVault(order.id, order.detailsHash, order.payerProof, canReadVault)
  const loserAcc = toBuyer === null ? undefined : toBuyer ? sellerAcc : buyerAcc
  const deductedBond = applyBond ? order.bond : 0n
  const marginAfterBond =
    loserAcc && loserAcc.effectiveMargin > deductedBond ? loserAcc.effectiveMargin - deductedBond : 0n
  const maxExtraSlash = marginAfterBond < order.amount ? marginAfterBond : order.amount
  const key = `rule-${order.id}`
  const takeKey = `take-${order.id}`

  const take = async () => {
    if (!escrowAddress) return
    await run(takeKey, 'Take case into review', () =>
      writeContractAsync({
        address: escrowAddress,
        abi: p2pEscrowAbi,
        functionName: 'takeCase',
        args: [order.rawId],
        chainId: CHAIN_ID,
      }),
    )
  }

  const rule = async () => {
    if (toBuyer === null || !escrowAddress) return
    await run(key, 'Rule on dispute', () =>
      writeContractAsync({
        address: escrowAddress,
        abi: p2pEscrowAbi,
        functionName: 'resolveDispute',
        args: [order.rawId, toBuyer, slash, applyBond],
        chainId: CHAIN_ID,
      }),
    )
  }

  return (
    <motion.li layout="position" className="glass overflow-hidden rounded-3xl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}>
          <ShieldAlert className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            Order #{order.rawId.toString()} ({asset})
            <span className="tabular-nums">{formatUsdcAmount(order.amount, undefined, asset)} {asset}</span>
            <StatusBadge status={order.status} />
            {inReview && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
                IN REVIEW
              </span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            {country && <CountryFlag code={country.code} size={16} />}
            {country?.symbol} {formatFiat(order.fiatAmountE6)} {currency}
            <span>Bond {formatUsdcAmount(order.bond, undefined, asset)} {asset}</span>
            {order.paidLate && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                Marked paid late
              </span>
            )}
            <span className="inline-flex items-center gap-1" style={{ color: stale ? 'var(--danger)' : undefined }}>
              <Clock className="size-3" /> {order.status === STATUS.PAID ? 'paid' : 'waiting'} {formatDuration(age)}
            </span>
          </span>
        </span>
        <ChevronDown className="size-5 shrink-0 transition-transform" style={{ color: 'var(--subtle)', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4 border-t p-4 sm:p-5"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <PartyRow
                role="Buyer"
                address={order.buyer}
                account={buyerAcc}
                profile={profiles?.get(order.buyer.toLowerCase())}
                partyOrders={allOrders.filter((o) => sameAddr(o.buyer, order.buyer) || sameAddr(o.seller, order.buyer))}
                currentOrderId={order.id}
                asset={asset}
              />
              <PartyRow
                role="Seller"
                address={order.seller}
                account={sellerAcc}
                profile={profiles?.get(order.seller.toLowerCase())}
                partyOrders={allOrders.filter((o) => sameAddr(o.buyer, order.seller) || sameAddr(o.seller, order.seller))}
                currentOrderId={order.id}
                asset={asset}
              />
            </div>

            {hasSealedHashes && canReadVault && !isSignedIn && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-xs"
                style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
              >
                <span className="flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                  <Lock className="size-3.5 shrink-0" />
                  Sign a free message with your arbiter wallet to decrypt sealed payment details &amp; payer proof.
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void signIn().catch((err) =>
                      toast.error(err instanceof BackendApiError ? err.message : 'Wallet signature cancelled.'),
                    )
                  }
                  disabled={signingIn}
                >
                  {signingIn ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                  Decrypt Vault
                </Button>
              </div>
            )}

            <div className="inner rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                  Seller receiving details
                </span>
                {(vaultQuery.data?.sellerDetails?.accountDetails || order.paymentDetails) && (
                  <CopyButton text={vaultQuery.data?.sellerDetails?.accountDetails || order.paymentDetails} />
                )}
              </div>
              {vaultQuery.data?.sellerDetails ? (
                <div className="mt-1.5 space-y-1 text-xs">
                  <p>
                    <span style={{ color: 'var(--subtle)' }}>Holder: </span>
                    <span className="font-semibold">{vaultQuery.data.sellerDetails.holderName}</span>
                    {' · '}
                    <span style={{ color: 'var(--subtle)' }}>
                      KYC name: {vaultQuery.data.sellerDetails.kycNameMatch.status}
                    </span>
                  </p>
                  <p className="mono whitespace-pre-wrap break-words">{vaultQuery.data.sellerDetails.accountDetails}</p>
                  {vaultQuery.data.sellerDetails.notes && (
                    <p style={{ color: 'var(--muted)' }}>Notes: {vaultQuery.data.sellerDetails.notes}</p>
                  )}
                </div>
              ) : (
                <p className="mono mt-1.5 whitespace-pre-wrap break-words text-xs">
                  {order.paymentDetails || 'Sealed payment details'}
                </p>
              )}
              <p className="mt-2 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                Price {formatPrice(order.priceE6)} {currency} per {asset} · opened {new Date(Number(order.createdAt) * 1000).toLocaleString()}
                {order.paidAt > 0n && ` · marked paid ${new Date(Number(order.paidAt) * 1000).toLocaleString()}`}
                {inReview && ` · review started ${new Date(Number(order.reviewStartedAt) * 1000).toLocaleString()}`}
              </p>
            </div>

            {vaultQuery.data?.buyerPayer && (
              <div className="inner rounded-xl p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                    Buyer payer proof (verified hash)
                  </span>
                  <CopyButton text={vaultQuery.data.buyerPayer.transferId} label="Copy TxID" />
                </div>
                <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                  <p>
                    <span style={{ color: 'var(--subtle)' }}>Transfer ID: </span>
                    <span className="mono font-semibold">{vaultQuery.data.buyerPayer.transferId}</span>
                  </p>
                  <p>
                    <span style={{ color: 'var(--subtle)' }}>Sender: </span>
                    <span className="font-semibold">{vaultQuery.data.buyerPayer.senderName}</span>
                    {vaultQuery.data.buyerPayer.last4 && ` (••${vaultQuery.data.buyerPayer.last4})`}
                  </p>
                  {vaultQuery.data.buyerPayer.paymentMethod && (
                    <p>
                      <span style={{ color: 'var(--subtle)' }}>Method: </span>
                      <span className="font-semibold">{vaultQuery.data.buyerPayer.paymentMethod}</span>
                    </p>
                  )}
                  <p>
                    <span style={{ color: 'var(--subtle)' }}>KYC name match: </span>
                    <span className="font-semibold">{vaultQuery.data.buyerPayer.kycNameMatch.status}</span>
                  </p>
                </div>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Evidence thread (public fallback)
              </h4>
              <OrderChat
                orderId={order.id}
                buyer={order.buyer}
                seller={order.seller}
                orderStatus={order.status}
                disputedAt={order.disputedAt}
                amountText={`${formatUsdcAmount(order.amount, undefined, asset)} ${asset}`}
                canPost={canRule && !isParty && order.status === STATUS.DISPUTED}
              />
            </div>

            {canRule && !isParty ? (
              <div className="rounded-2xl p-4" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Gavel className="size-4" /> Arbiter case &amp; ruling
                  </h4>
                  {!inReview && (
                    <Button variant="ghost" loading={pendingKey === takeKey} onClick={() => void take()}>
                      <Briefcase className="size-4" /> Take case
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                  Taking the case marks <span className="mono">reviewStartedAt</span> onchain (settling after review starts counts as a lost dispute with 0 bond). When ruling, choose whether the loser owes the {formatUsdcAmount(order.bond, undefined, asset)} {asset} bond. Escrowed order {asset} is never reduced.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Ruling">
                  {[
                    { v: true, title: 'Release to buyer', body: 'Buyer proved payment' },
                    { v: false, title: 'Return to seller', body: 'Payment not received' },
                  ].map((o) => (
                    <button
                      key={o.title}
                      role="radio"
                      aria-checked={toBuyer === o.v}
                      onClick={() => setToBuyer(o.v)}
                      className="rounded-xl p-3 text-left transition-colors"
                      style={{
                        background: toBuyer === o.v ? 'var(--fill-3)' : 'transparent',
                        border: `1px solid ${toBuyer === o.v ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      <span className="block text-sm font-semibold">{o.title}</span>
                      <span className="block text-xs" style={{ color: 'var(--subtle)' }}>{o.body}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={applyBond} onChange={(e) => setApplyBond(e.target.checked)} className="mt-1 size-4" />
                  <span>
                    Charge {formatUsdcAmount(order.bond, undefined, asset)} {asset} dispute bond to the losing party
                    <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
                      Paid from free margin first; any shortfall becomes debt blocking new ads/orders.
                    </span>
                  </span>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={slash} onChange={(e) => setSlash(e.target.checked)} className="mt-1 size-4" />
                  <span>
                    Also slash extra margin from the losing party
                    {loserAcc && (
                      <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
                        Up to {formatUsdcAmount(maxExtraSlash, undefined, asset)} {asset} goes to the winner.
                      </span>
                    )}
                  </span>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-1 size-4" />
                  <span>I reviewed the evidence from both sides. This ruling is final.</span>
                </label>
                <Button className="mt-4 w-full sm:w-auto" disabled={toBuyer === null || !reviewed} loading={pendingKey === key} onClick={() => void rule()}>
                  Confirm ruling
                </Button>
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--subtle)' }}>
                {isParty
                  ? 'You are a party to this order, so you cannot rule on it.'
                  : !paidReady
                    ? `Paid orders without an onchain dispute unlock for arbiter review 15 minutes after markPaid (${formatDuration(paidWaitLeft)} left).`
                    : isBackupArbiter && !backupReady
                      ? `Backup arbiter window opens in ${formatDuration(backupRemaining)} (7 days after dispute or paidAt).`
                      : 'Only the arbiter (or backup arbiter after 7 days) can take or rule on a case.'}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}
