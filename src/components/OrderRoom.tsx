import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Gavel,
  Handshake,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  BACKUP_ARBITER_DELAY_SECONDS,
  CHAIN_ID,
  COOLING_OFF_SECONDS,
  ESCROW_ADDRESS,
  GRACE_SECONDS,
  STATUS,
  STATUS_META,
  ZERO_BYTES32,
  countryByCurrency,
  formatDuration,
  formatFiat,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  maskToMethods,
  sameAddr,
  shortAddr,
} from '@/lib/p2p'
import {
  useArbiter,
  useBackupArbiter,
  useNow,
  useOrder,
  useOrderMessages,
  usePrivacySwitches,
  type OrderWithId,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { OrderChat } from '@/components/OrderChat'
import { BackendApiError } from '@/lib/api'
import { useP2pAccount } from '@/hooks/useAccount'
import { useOrderVault, useVaultActions, type NameMatchBadgeData } from '@/hooks/useVault'

const DISPUTE_WAIT = 15 * 60

function formatDaysHours(sec: number): string {
  if (sec <= 0) return 'Unlocked'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`
}

function TapCopyButton({ text, label = 'Copy', toastText = 'Copied!' }: { text: string; label?: string; toastText?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          toast.success(toastText)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2.5 py-1 text-xs font-bold text-[#FF5A00] active:scale-95"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

function NameMatchBadge({ match }: { match: NameMatchBadgeData }) {
  if (match.status === 'match') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
        <Check className="size-3" /> KYC Name Match{match.maskedInitials ? ` (${match.maskedInitials})` : ''}
      </span>
    )
  }
  if (match.status === 'mismatch') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
        <AlertTriangle className="size-3" /> KYC Name Mismatch{match.maskedInitials ? ` (${match.maskedInitials})` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--p2p-muted)]">
      KYC Unverified
    </span>
  )
}

export function OrderRoom({ orderId, onClose }: { orderId: bigint | null; onClose: () => void }) {
  if (orderId === null) return null
  return <OrderExecutionScreen orderId={orderId} onClose={onClose} />
}

function OrderExecutionScreen({ orderId, onClose }: { orderId: bigint; onClose: () => void }) {
  const { order, isLoading } = useOrder(orderId)

  if (isLoading && !order) {
    return (
      <div className="space-y-4">
        <div className="p2p-card h-12 animate-pulse rounded-xl" />
        <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="p2p-card h-96 animate-pulse rounded-xl" />
          <div className="p2p-card hidden h-96 animate-pulse rounded-xl md:block" />
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="p2p-card rounded-xl p-8 text-center">
        <p className="text-base font-bold text-[var(--p2p-ink)]">Order #{orderId.toString()} not found</p>
        <p className="mt-1 text-xs text-[var(--p2p-muted)]">
          This order ID does not exist on the active escrow contract.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF]"
        >
          <ArrowLeft className="size-4" /> Back to P2P Trade
        </button>
      </div>
    )
  }

  return <OrderExecutionBody order={order} onClose={onClose} />
}

function OrderExecutionBody({ order, onClose }: { order: OrderWithId; onClose: () => void }) {
  const { address } = useAccount()
  const arbiter = useArbiter()
  const backupArbiter = useBackupArbiter()
  const { payerProofRequired } = usePrivacySwitches()
  const { isSignedIn, signIn, signingIn } = useP2pAccount()
  const { sealPayerProof } = useVaultActions()
  const { data: messages } = useOrderMessages(order.id)
  const now = useNow()
  const { run, writeContractAsync, pendingKey, busy: txBusy } = useTx()

  const [senderName, setSenderName] = useState('')
  const [last4, setLast4] = useState('')
  const [transferId, setTransferId] = useState('')
  const [sealingPayer, setSealingPayer] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [slash, setSlash] = useState(false)
  const [applyBond, setApplyBond] = useState(true)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [seenMessages, setSeenMessages] = useState(0)

  const busy = txBusy || sealingPayer

  const totalMessages = messages?.length ?? 0
  const unreadCount = Math.max(0, totalMessages - seenMessages)

  const currency = hexToCurrency(order.currency)
  const country = countryByCurrency(currency)
  const isBuyer = sameAddr(address, order.buyer)
  const isSeller = sameAddr(address, order.seller)
  const isPrimaryArbiter = sameAddr(address, arbiter) && !isBuyer && !isSeller
  const isBackupWallet = sameAddr(address, backupArbiter) && !isBuyer && !isSeller
  const backupAnchor = order.disputedAt > 0n ? Number(order.disputedAt) : Number(order.paidAt)
  const backupWaitLeft = BACKUP_ARBITER_DELAY_SECONDS - (now - backupAnchor)
  const isBackupReady = isBackupWallet && backupWaitLeft <= 0
  const paid15mLeft = Number(order.paidAt) + DISPUTE_WAIT - now
  const arbiterTimeReady = order.disputedAt > 0n || paid15mLeft <= 0
  const canRule = arbiterTimeReady && (isPrimaryArbiter || isBackupReady)
  const canReadVault = isBuyer || isSeller || isPrimaryArbiter || isBackupReady
  const vaultQuery = useOrderVault(order.id, order.detailsHash, order.payerProof, canReadVault)
  const sellerVault = vaultQuery.data?.sellerDetails ?? null
  const buyerVault = vaultQuery.data?.buyerPayer ?? null

  const role = isBuyer
    ? 'Buyer'
    : isSeller
      ? 'Seller'
      : isPrimaryArbiter
        ? 'Primary Arbiter'
        : isBackupWallet
          ? 'Backup Arbiter'
          : 'Observer'

  const deadline = Number(order.deadline)
  const remaining = deadline - now
  const pastDeadline = remaining <= 0
  const hardExpired = now > deadline + GRACE_SECONDS
  const status = order.status
  const inReview = order.reviewStartedAt > 0n
  const coolingOffLeft = Number(order.disputedAt) + COOLING_OFF_SECONDS - now
  const inCoolingOff = !inReview && coolingOffLeft >= 0

  const senderNameReady = senderName.trim().length >= 2
  const senderFieldsReady = senderNameReady && /^\d{4}$/.test(last4)
  const transferIdReady = transferId.trim().length >= 2
  const payerReady = pastDeadline
    ? transferIdReady && (!payerProofRequired || senderNameReady)
    : payerProofRequired
      ? senderNameReady && (transferIdReady || /^\d{4}$/.test(last4))
      : senderFieldsReady || transferIdReady
  const payerHash = payerReady
    ? keccak256(
        toBytes(
          `${order.id.toString()}|tx:${transferId.trim()}|${senderName.trim().toLowerCase()}|${last4}`,
        ),
      )
    : ZERO_BYTES32

  const callSimple = (
    name: 'release' | 'cancelOrder' | 'openDispute' | 'takeCase',
    label: string,
    key: string = name,
  ) =>
    run(key, label, () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: name,
        args: [order.id],
        chainId: CHAIN_ID,
      }),
    )

  const callMarkPaid = async () => {
    let proofArg: `0x${string}` = payerHash
    if (payerReady && (payerProofRequired || isSignedIn)) {
      setSealingPayer(true)
      try {
        const res = await sealPayerProof({
          orderId: order.id,
          transferId: transferId.trim(),
          senderName: senderName.trim(),
          last4,
        })
        proofArg = res.contentHash
      } catch (err) {
        setSealingPayer(false)
        if (payerProofRequired) {
          toast.error(
            err instanceof BackendApiError ? err.message : 'Sign in with your wallet to seal your payer proof.',
          )
          return
        }
        // Emergency fallback when payerProofRequired is off so a late-marking buyer is never trapped
      }
      setSealingPayer(false)
    }

    await run('markPaid', 'Notify seller of payment', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'markPaid',
        args: [order.id, proofArg],
        chainId: CHAIN_ID,
      }),
    )
  }

  const resolve = (toBuyer: boolean) =>
    run(toBuyer ? 'resolveBuyer' : 'resolveSeller', 'Resolve dispute', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'resolveDispute',
        args: [order.id, toBuyer, slash, applyBond],
        chainId: CHAIN_ID,
      }),
    )

  const canBuyerDispute = status === STATUS.PAID && now >= Number(order.paidAt) + DISPUTE_WAIT
  const disputeWaitLeft = Number(order.paidAt) + DISPUTE_WAIT - now
  const methods = maskToMethods(order.paymentMask)
  const fiatPlain = formatFiat(order.fiatAmountE6)

  const stepIndex =
    status === STATUS.PENDING
      ? 2
      : status === STATUS.PAID || status === STATUS.DISPUTED
        ? 3
        : 4

  const escrowStatusLabel =
    status === STATUS.COMPLETED || status === STATUS.RESOLVED_BUYER
      ? 'Released to Buyer'
      : status === STATUS.CANCELLED || status === STATUS.RESOLVED_SELLER
        ? 'Returned to Seller'
        : status === STATUS.SETTLED
          ? 'Settled by Parties'
          : 'Locked on Arc'

  const mobileTitle =
    status === STATUS.PENDING
      ? isBuyer
        ? 'Pay the Seller'
        : 'Awaiting Buyer'
      : status === STATUS.PAID
        ? isSeller
          ? 'Verify & Release'
          : 'Awaiting Release'
        : status === STATUS.DISPUTED
          ? 'Dispute Open'
          : STATUS_META[status]?.label ?? 'Order'

  const canPostChat =
    (status === STATUS.PENDING || status === STATUS.PAID || status === STATUS.DISPUTED) &&
    (isBuyer || isSeller || (canRule && status === STATUS.DISPUTED))

  const openMobileChat = () => {
    setSeenMessages(totalMessages)
    setMobileChatOpen(true)
  }

  // Gate order actions and chat behind a gasless wallet sign-in so users decrypt
  // payment details and unlock free encrypted chat before interacting.
  if (canReadVault && !isSignedIn) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="p2p-card flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)] hover:text-[#FF5A00]"
            >
              <ArrowLeft className="size-3.5" /> Market
            </button>
            <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">Order #{order.id.toString()}</span>
            <span className="rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
              {STATUS_META[status]?.label ?? 'Unknown'}
            </span>
          </div>
          <span className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2.5 py-1 text-xs text-[var(--p2p-muted)]">
            Role: <strong className="text-[var(--p2p-ink)]">{role}</strong>
          </span>
        </div>

        <section className="p2p-card rounded-xl p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">USDC Escrow</span>
              <span className="p2p-mono mt-1 block text-base font-bold text-[var(--p2p-ink)]">
                {formatUsdcAmount(order.amount)} USDC
              </span>
            </div>
            <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Fiat Amount</span>
              <span className="p2p-mono mt-1 block text-base font-bold text-[#FF5A00]">
                {country?.symbol ?? ''} {fiatPlain} {currency}
              </span>
            </div>
            <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Unit Rate</span>
              <span className="p2p-mono mt-1 block text-base font-bold text-[var(--p2p-ink)]">
                {formatPrice(order.priceE6)} {currency}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-5 text-center space-y-3">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[#FF5A00]/15 text-[#FF5A00]">
              <Lock className="size-5" />
            </div>
            <h2 className="text-base font-bold text-[var(--p2p-ink)]">Decrypt Order to Continue</h2>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-[var(--p2p-muted)]">
              Sign a free, gasless message with your wallet to decrypt sealed payment details, unlock gasless
              encrypted order chat, and access order actions.
            </p>
            <button
              type="button"
              disabled={signingIn}
              onClick={() =>
                void signIn().catch((err) =>
                  toast.error(err instanceof BackendApiError ? err.message : 'Wallet signature was cancelled.'),
                )
              }
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-50"
            >
              {signingIn ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {signingIn ? 'Decrypting...' : 'Sign In & Decrypt Order'}
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24 md:space-y-5 md:pb-0">
      {/* =====================================================================
          MOBILE TOP PINNED TIMER & FLOATING CHAT BUTTON (< 768px)
         ===================================================================== */}
      <div className="p2p-card sticky top-[108px] z-30 flex items-center justify-between gap-2 rounded-xl px-3.5 py-3 sm:top-[64px] md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to market"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--p2p-ink)]">{mobileTitle}</p>
            <p className="p2p-mono truncate text-[10px] text-[var(--p2p-muted)]">
              Order #{order.id.toString()} • {role}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status === STATUS.PENDING && !pastDeadline && (
            <span className="p2p-mono inline-flex items-center gap-1 rounded-full bg-[#FF5A00] px-2.5 py-1 text-xs font-bold text-[#FFFFFF]">
              <Clock className="size-3" />
              {formatDuration(remaining)}
            </span>
          )}
          {status === STATUS.PENDING && pastDeadline && (
            <span className="p2p-mono inline-flex items-center gap-1 rounded-full border border-red-500/60 bg-red-500/15 px-2.5 py-1 text-xs font-bold text-red-500">
              <AlertTriangle className="size-3" />
              Time expired
            </span>
          )}

          <button
            type="button"
            onClick={openMobileChat}
            className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-3 text-xs font-bold text-[#FF5A00]"
          >
            <MessageSquare className="size-3.5" />
            <span>Chat</span>
            {(unreadCount > 0 || totalMessages > 0) && (
              <span className="p2p-mono rounded-full bg-[#FF5A00] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#FFFFFF]">
                {unreadCount > 0 ? unreadCount : totalMessages}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* =====================================================================
          DESKTOP TOP BREADCRUMB & ORDER HEADER (>= 768px)
         ===================================================================== */}
      <div className="p2p-card hidden flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-3 md:flex">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--p2p-ink)] transition-colors hover:border-[var(--p2p-border-active)] hover:text-[#FF5A00]"
          >
            <ArrowLeft className="size-3.5" /> Market
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">Order #{order.id.toString()}</span>
            <span className="rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
              {STATUS_META[status]?.label ?? 'Unknown'}
            </span>
            {order.paidLate && (
              <span className="rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                Marked paid late
              </span>
            )}
            {inReview && (
              <span className="rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-2 py-0.5 text-[10px] font-semibold text-[#FF5A00]">
                Arbiter in review
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2.5 py-1 text-[var(--p2p-muted)]">
            Role: <strong className="text-[var(--p2p-ink)]">{role}</strong>
          </span>
          {ESCROW_ADDRESS && (
            <a
              href={buildAddressExplorerUrl(CHAIN_ID, ESCROW_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#FF5A00] hover:underline"
            >
              Escrow Contract <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>

      {/* =====================================================================
          MAIN GRID: SINGLE-COLUMN ON MOBILE (< 768px) / 60-40 SPLIT ON DESKTOP (>= 768px)
         ===================================================================== */}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* LEFT COLUMN */}
        <div className="space-y-3.5 md:space-y-4">
          {/* 1. Top 3-Step Progress Stepper (Desktop & Tablet) */}
          <div className="p2p-card hidden rounded-xl p-4 sm:block">
            <ol className="grid gap-3 sm:grid-cols-3">
              {[
                { n: 1, title: 'Order Created', sub: 'USDC Locked in Escrow' },
                { n: 2, title: 'Transfer Fiat', sub: 'Verify Payer & Notify' },
                { n: 3, title: 'Release USDC', sub: 'Seller Confirms Receipt' },
              ].map((s) => {
                const done = stepIndex > s.n || status === STATUS.COMPLETED || status === STATUS.RESOLVED_BUYER
                const active = stepIndex === s.n && status !== STATUS.CANCELLED && status !== STATUS.RESOLVED_SELLER
                return (
                  <li key={s.n} className="flex items-center gap-2.5">
                    <span
                      className={`p2p-mono flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        done || active
                          ? 'bg-[#FF5A00] text-[#FFFFFF]'
                          : 'border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
                      }`}
                    >
                      {done ? <Check className="size-3.5" /> : s.n}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`truncate text-xs font-bold ${
                          done || active ? 'text-[var(--p2p-ink)]' : 'text-[var(--p2p-muted)]'
                        }`}
                      >
                        {s.title}
                      </p>
                      <p className="truncate text-[11px] text-[var(--p2p-muted)]">{s.sub}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* 2. Dynamic Countdown / Red Expired State (No grace countdown shown) */}
          {status === STATUS.PENDING && pastDeadline && (
            <div className="p2p-card rounded-xl !border-red-500/70 !bg-red-500/10 p-3.5 md:hidden">
              <p className="flex items-start gap-2 text-xs font-bold text-red-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {hardExpired
                    ? 'Time expired. Order cancellation is now unlocked.'
                    : 'Time expired. Already paid? Mark it as paid now and add your transfer ID.'}
                </span>
              </p>
            </div>
          )}

          {status === STATUS.PENDING && (
            <div
              className={`p2p-card hidden rounded-xl p-4 md:block ${
                pastDeadline ? '!border-red-500/70 !bg-red-500/10' : '!border-[var(--p2p-border-active)]'
              }`}
            >
              {pastDeadline ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-red-500">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>
                      {hardExpired
                        ? 'Time expired. Order cancellation is now unlocked.'
                        : 'Time expired. Already paid? Mark it as paid now and add your transfer ID.'}
                    </span>
                  </div>
                  <span className="p2p-mono rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-1 text-sm font-bold text-red-500">
                    Time expired
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-[var(--p2p-ink)]">
                      {isBuyer ? 'Complete fiat payment within' : 'Awaiting buyer fiat transfer'}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--p2p-muted)]">
                      Escrow holds {formatUsdcAmount(order.amount)} USDC safely until release.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3.5 py-2 text-right">
                    <span className="p2p-mono text-xl font-bold text-[#FF5A00]">{formatDuration(remaining)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. Card: Amount to Pay / Order Summary */}
          <div className="p2p-card rounded-xl p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--p2p-border)] pb-4">
              <div>
                <span className="text-xs text-[var(--p2p-muted)]">
                  {isSeller ? 'Fiat Amount to Receive' : 'Amount to Pay'}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-2.5">
                  <span className="p2p-mono text-2xl font-bold text-[#FF5A00] sm:text-3xl">
                    {country?.symbol}
                    {fiatPlain} <span className="text-base">{currency}</span>
                  </span>
                  <TapCopyButton text={fiatPlain.replace(/,/g, '')} label="Copy" toastText="Amount copied!" />
                </div>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-xs text-[var(--p2p-muted)]">
                  {isBuyer ? 'Receive Amount' : 'Escrowed Amount'}
                </span>
                <p className="p2p-mono mt-1 text-xl font-bold text-[var(--p2p-ink)] sm:text-2xl">
                  {formatUsdcAmount(order.amount)} USDC
                </p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-[var(--p2p-muted)]">Exchange Rate</dt>
                <dd className="p2p-mono mt-0.5 font-semibold text-[var(--p2p-ink)]">
                  {formatPrice(order.priceE6)} {currency}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--p2p-muted)]">Escrow Status</dt>
                <dd className="mt-0.5 inline-flex items-center gap-1 font-semibold text-[#FF5A00]">
                  <Lock className="size-3" /> {escrowStatusLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--p2p-muted)]">Dispute Bond</dt>
                <dd className="p2p-mono mt-0.5 font-semibold text-[var(--p2p-ink)]">
                  {formatUsdcAmount(order.bond)} USDC
                </dd>
              </div>
              <div>
                <dt className="text-[var(--p2p-muted)]">Counterparties</dt>
                <dd className="p2p-mono mt-0.5 text-[var(--p2p-ink)]">
                  B:{shortAddr(order.buyer).slice(0, 6)} • S:{shortAddr(order.seller).slice(0, 6)}
                </dd>
              </div>
            </dl>
          </div>

          {/* 4. Card: Payment Method & 1-Tap Account Copy (Plain or Encrypted Mode 2 Vault) */}
          {(status === STATUS.PENDING || status === STATUS.PAID || status === STATUS.DISPUTED) && (
            <div className="p2p-card rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--p2p-ink)]">
                    {isSeller ? 'Your Receiving Details' : "Seller's Payment Account"}
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[10px] font-semibold text-[#FF5A00]">
                    <ShieldCheck className="size-3" />
                    {order.detailsHash !== ZERO_BYTES32 ? 'Vault Encrypted • Hash Verified' : 'Escrow Record'}
                  </span>
                  {sellerVault && <NameMatchBadge match={sellerVault.kycNameMatch} />}
                </div>
                {(sellerVault?.accountDetails || order.paymentDetails) && (
                  <TapCopyButton
                    text={sellerVault?.accountDetails ?? order.paymentDetails}
                    label="Copy Account"
                    toastText="Payment account copied! Switch to your payment app."
                  />
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {methods.map((m) => (
                  <span
                    key={m.bit}
                    className="inline-flex items-center rounded bg-[var(--p2p-input-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--p2p-ink)] ring-1 ring-inset ring-[var(--p2p-border)]"
                    style={{ borderLeft: '3px solid #FF5A00' }}
                  >
                    {m.name}
                  </span>
                ))}
              </div>

              <div className="mt-3 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5">
                {sellerVault ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--p2p-muted)]">
                        Account Holder: <strong className="text-[var(--p2p-ink)]">{sellerVault.holderName}</strong>
                      </span>
                      <TapCopyButton
                        text={sellerVault.holderName}
                        label="Copy Name"
                        toastText="Account holder name copied!"
                      />
                    </div>
                    <p className="p2p-mono whitespace-pre-wrap break-words text-sm font-bold text-[var(--p2p-ink)]">
                      {sellerVault.accountDetails}
                    </p>
                    {sellerVault.notes && (
                      <p className="text-xs text-[var(--p2p-muted)]">Terms: {sellerVault.notes}</p>
                    )}
                  </div>
                ) : order.paymentDetails ? (
                  <p className="p2p-mono whitespace-pre-wrap break-words text-sm font-semibold text-[var(--p2p-ink)]">
                    {order.paymentDetails}
                  </p>
                ) : order.detailsHash !== ZERO_BYTES32 && canReadVault && !isSignedIn ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[var(--p2p-muted)]">
                      Payment details are encrypted in the OnPeer Vault (<span className="p2p-mono">{order.detailsHash.slice(0, 12)}...</span>). Sign a free message to decrypt.
                    </p>
                    <button
                      type="button"
                      disabled={signingIn}
                      onClick={() => void signIn().catch(() => undefined)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-50"
                    >
                      {signingIn ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                      {signingIn ? 'Signing...' : 'Sign In to Reveal'}
                    </button>
                  </div>
                ) : vaultQuery.isLoading ? (
                  <p className="text-xs text-[var(--p2p-muted)]">Decrypting verified payment details...</p>
                ) : (
                  <p className="p2p-mono text-sm font-semibold text-[var(--p2p-muted)]">
                    Awaiting seller payment details reveal...
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 5. BUYER IN PENDING: Payer Verification + Transfer ID Inputs (+ Desktop Action Buttons) */}
          {status === STATUS.PENDING && isBuyer && (
            <div
              className={`p2p-card space-y-4 rounded-xl p-4 sm:p-5 ${
                pastDeadline ? '!border-red-500/60' : ''
              }`}
            >
              <div>
                <h3 className="text-sm font-bold text-[var(--p2p-ink)]">
                  {pastDeadline
                    ? 'Time Expired — Add Your Transfer ID to Mark Paid'
                    : 'Verify Payer Account & Transfer ID'}
                </h3>
                <p className="mt-0.5 text-xs text-[var(--p2p-muted)]">
                  Pay strictly from an account in your own name.{' '}
                  {pastDeadline
                    ? 'After the deadline, your transfer ID is required onchain (limited to 2 late marks per 30 days).'
                    : 'Enter your transfer reference or sender details before notifying the seller.'}
                </p>
              </div>

              <div className="grid gap-3 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span
                    className={`mb-1 block text-[11px] font-semibold ${
                      pastDeadline ? 'text-red-500' : 'text-[var(--p2p-muted)]'
                    }`}
                  >
                    Transfer ID / Bank Reference {pastDeadline ? '(Required)' : '(Recommended)'}
                  </span>
                  <input
                    type="text"
                    value={transferId}
                    onChange={(e) => setTransferId(e.target.value.slice(0, 80))}
                    placeholder="e.g. TXN94827104 / UTR / TrxID"
                    className={`p2p-input p2p-mono h-11 w-full rounded-lg px-3 text-xs font-bold ${
                      pastDeadline ? '!border-red-500/60' : ''
                    }`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--p2p-muted)]">
                    Your Sender Account Name
                  </span>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value.slice(0, 60))}
                    placeholder="Full account holder name"
                    className="p2p-input h-11 w-full rounded-lg px-3 text-xs font-medium"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--p2p-muted)]">
                    Last 4 Digits of Account / Phone
                  </span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={last4}
                    onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="e.g. 4829"
                    className="p2p-input p2p-mono h-11 w-full rounded-lg px-3 text-xs font-bold tracking-widest"
                  />
                </label>
                <p className="text-[11px] text-[var(--p2p-muted)] sm:col-span-2">
                  Hashes your transfer ID &amp; sender info into{' '}
                  <span className="p2p-mono text-[var(--p2p-ink)]">payerProof</span>
                  {payerReady ? ` (${payerHash.slice(0, 12)}...)` : ''} onchain.
                </p>
              </div>

              {/* Desktop Action Row (Mobile uses Sticky Thumb-Zone Bar below) */}
              <div className="hidden gap-2.5 md:flex">
                <button
                  type="button"
                  disabled={!payerReady || hardExpired || busy}
                  onClick={() => void callMarkPaid()}
                  className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                    pastDeadline ? 'bg-red-600' : 'bg-[#FF5A00]'
                  }`}
                >
                  {pendingKey === 'markPaid' && <Loader2 className="size-4 animate-spin" />}
                  {pastDeadline ? 'Mark as Paid with Transfer ID' : 'Transferred, Notify Seller'}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void callSimple('cancelOrder', 'Cancel order')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-5 text-sm font-semibold text-[var(--p2p-ink)] transition-colors hover:border-[var(--p2p-border-active)] disabled:opacity-40"
                >
                  {pendingKey === 'cancelOrder' && <Loader2 className="size-4 animate-spin" />}
                  Cancel Order
                </button>
              </div>

              {order.buyer === order.taker && (
                <p className="text-[11px] text-[var(--p2p-muted)]">
                  Note: 3 cancellations in 24h trigger a 24h trading cooldown. Never cancel after you have sent fiat.
                </p>
              )}
            </div>
          )}

          {/* SELLER / OTHERS IN PENDING */}
          {status === STATUS.PENDING && !isBuyer && (
            <div className="p2p-card space-y-3 rounded-xl p-4 sm:p-5">
              {isSeller && (
                <p className="text-xs leading-relaxed text-[var(--p2p-muted)]">
                  {hardExpired
                    ? 'Payment window expired without payment confirmation. You may cancel the order now.'
                    : pastDeadline
                      ? 'Payment timer expired. Wait briefly in case the buyer is submitting a transfer ID, then cancellation unlocks.'
                      : 'Waiting for the buyer to send fiat and mark the order as paid. Only release USDC once you verify the exact amount inside your payment app.'}
                </p>
              )}

              <div className="hidden flex-wrap gap-2.5 md:flex">
                {isSeller && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void callSimple('release', 'Release USDC')}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-ink)] transition-colors hover:border-[#FF5A00]"
                  >
                    {pendingKey === 'release' && <Loader2 className="size-4 animate-spin" />}
                    Release USDC Early
                  </button>
                )}
                {hardExpired && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void callSimple('cancelOrder', 'Cancel expired order')}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {pendingKey === 'cancelOrder' && <Loader2 className="size-4 animate-spin" />}
                    Cancel Expired Order
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SELLER IN PAID */}
          {status === STATUS.PAID && isSeller && (
            <div className="p2p-card space-y-4 rounded-xl !border-[#FF5A00] p-4 sm:p-5">
              <div className="rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3.5">
                <p className="text-xs font-bold text-[#FF5A00]">Buyer Marked Order Paid — Verify Receipt</p>
                <p className="mt-1 text-xs text-[var(--p2p-ink)]">
                  Expected amount:{' '}
                  <strong className="p2p-mono text-[#FF5A00]">
                    {country?.symbol}
                    {fiatPlain} {currency}
                  </strong>
                </p>
                {order.payerProof !== ZERO_BYTES32 && (
                  <div className="mt-2.5 space-y-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--p2p-ink)]">Buyer Payer Attestation</span>
                      {buyerVault && <NameMatchBadge match={buyerVault.kycNameMatch} />}
                    </div>
                    {buyerVault ? (
                      <div className="grid gap-1 text-[11px] sm:grid-cols-3">
                        <span>
                          Sender: <strong className="text-[var(--p2p-ink)]">{buyerVault.senderName || '—'}</strong>
                        </span>
                        <span className="p2p-mono">
                          Transfer ID: <strong className="text-[#FF5A00]">{buyerVault.transferId || '—'}</strong>
                        </span>
                        <span className="p2p-mono">
                          Last 4: <strong className="text-[var(--p2p-ink)]">{buyerVault.last4 || '—'}</strong>
                        </span>
                      </div>
                    ) : !isSignedIn ? (
                      <button
                        type="button"
                        disabled={signingIn}
                        onClick={() => void signIn().catch(() => undefined)}
                        className="inline-flex items-center gap-1 font-semibold text-[#FF5A00] underline"
                      >
                        <KeyRound className="size-3" /> Sign in with wallet to decrypt buyer sender details
                      </button>
                    ) : (
                      <p className="p2p-mono break-all text-[11px] text-[var(--p2p-muted)]">
                        Proof Hash: <span className="text-[var(--p2p-ink)]">{order.payerProof}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs text-[var(--p2p-ink)]">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
                />
                <span>
                  I have logged into my banking/mobile app and verified that the exact amount arrived from an account in the buyer&apos;s own name (no third-party payment).
                </span>
              </label>

              <div className="hidden gap-2.5 md:flex">
                <button
                  type="button"
                  disabled={busy || !confirmed}
                  onClick={() => void callSimple('release', 'Release USDC')}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingKey === 'release' && <Loader2 className="size-4 animate-spin" />}
                  Release USDC
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void callSimple('openDispute', 'Open dispute')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#FF5A00] bg-transparent px-4 text-xs font-bold text-[#FF5A00] transition-colors hover:bg-[var(--p2p-tint)] disabled:opacity-40"
                >
                  {pendingKey === 'openDispute' && <Loader2 className="size-4 animate-spin" />}
                  Open Dispute (Not Received)
                </button>
              </div>

              <p className="text-[11px] text-[var(--p2p-muted)]">
                Asymmetric Dispute Bond: <strong className="p2p-mono text-[var(--p2p-ink)]">{formatUsdcAmount(order.bond)} USDC</strong> (0 upfront cost; if an arbiter rules, the loser owes the bond from margin or recorded debt).
              </p>
            </div>
          )}

          {/* BUYER IN PAID */}
          {status === STATUS.PAID && isBuyer && (
            <div className="p2p-card space-y-3.5 rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[var(--p2p-ink)]">Waiting for Seller to Release USDC</p>
                  <p className="mt-0.5 text-xs text-[var(--p2p-muted)]">
                    Tap Chat to share your transaction reference if the seller needs help locating it.
                  </p>
                </div>
                {!canBuyerDispute && (
                  <span className="p2p-mono rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3 py-1.5 text-xs font-bold text-[#FF5A00]">
                    Dispute in {formatDuration(disputeWaitLeft)}
                  </span>
                )}
              </div>

              <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs text-[var(--p2p-muted)]">
                <strong className="text-[var(--p2p-ink)]">Dispute Bond Rule ({formatUsdcAmount(order.bond)} USDC):</strong> You need <strong className="text-[var(--p2p-ink)]">0 USDC</strong> in your wallet to open a dispute. When an arbiter rules, your full {formatUsdcAmount(order.amount)} USDC is never reduced — the losing party owes the {formatUsdcAmount(order.bond)} USDC bond from margin or deferred unban debt.
              </div>

              <button
                type="button"
                disabled={!canBuyerDispute || busy}
                onClick={() => void callSimple('openDispute', 'Open dispute')}
                className="hidden min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#FF5A00] bg-[var(--p2p-tint)] px-4 text-xs font-bold text-[#FF5A00] transition-colors hover:bg-[#FF5A00] hover:text-[#FFFFFF] disabled:cursor-not-allowed disabled:opacity-40 md:inline-flex"
              >
                {pendingKey === 'openDispute' && <Loader2 className="size-4 animate-spin" />}
                {canBuyerDispute
                  ? 'Seller Not Responding — Open Dispute'
                  : `Open Dispute Cooldown (${formatDuration(disputeWaitLeft)})`}
              </button>
            </div>
          )}

          {/* DISPUTED STATE */}
          {status === STATUS.DISPUTED && (
            <div className="p2p-card space-y-4 rounded-xl !border-[#FF5A00] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p2p-border)] pb-3.5">
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-bold text-[#FF5A00]">
                    <ShieldAlert className="size-4 shrink-0" />
                    Dispute Active • {inReview ? 'Arbiter In Review' : inCoolingOff ? `Cooling-off (${formatDuration(coolingOffLeft)})` : 'Post Cooling-off'}
                  </p>
                  <p className="text-xs text-[var(--p2p-muted)]">
                    Escrowed {formatUsdcAmount(order.amount)} USDC stays 100% intact. When an arbiter rules, the arbiter decides whether the loser pays the {formatUsdcAmount(order.bond)} USDC bond.
                  </p>
                </div>
                <span className="p2p-mono rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--p2p-ink)]">
                  Backup Arbiter: <span className="text-[#FF5A00]">{formatDaysHours(backupWaitLeft)}</span>
                </span>
              </div>

              {(isSeller || isBuyer) && (
                <div className="space-y-3 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] p-3.5">
                  <p className="text-xs font-semibold text-[var(--p2p-ink)]">
                    {inReview
                      ? 'Arbiter has taken the case — settling now records 1 lost dispute (0 bond owed • no completion credit).'
                      : inCoolingOff
                        ? `30m Cooling-off (${formatDuration(coolingOffLeft)} left) — settle cleanly with 0 bond, 0 strike, and 0 concession.`
                        : 'Cooling-off ended — settling now counts as 1 concession (2 concessions = 1 lost dispute • 0 bond owed).'}
                  </p>
                  <div className="hidden md:block">
                    {isSeller && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void callSimple('release', 'Settle & release to buyer', 'settleRelease')}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {pendingKey === 'settleRelease' ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Handshake className="size-4" />
                        )}
                        Settle Dispute Now — Release USDC to Buyer
                      </button>
                    )}
                    {isBuyer && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void callSimple('cancelOrder', 'Settle & cancel dispute', 'settleCancel')}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#FF5A00] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[#FF5A00] transition-colors hover:bg-[#FF5A00] hover:text-[#FFFFFF] disabled:opacity-40"
                      >
                        {pendingKey === 'settleCancel' ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Handshake className="size-4" />
                        )}
                        Settle Dispute Now — Cancel &amp; Return USDC to Seller
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ARBITER CASE CONTROL (from Paid >= 15m or Disputed) */}
          {(status === STATUS.DISPUTED || status === STATUS.PAID) && (isPrimaryArbiter || isBackupWallet) && (
            <div className="p2p-card space-y-3 rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-bold text-[var(--p2p-ink)]">
                  <Gavel className="size-4 text-[#FF5A00]" /> Arbiter Case &amp; Ruling
                </p>
                {!inReview && canRule && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void callSimple('takeCase', 'Take case into review')}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#FF5A00] bg-[var(--p2p-tint)] px-3 text-xs font-bold text-[#FF5A00] hover:bg-[#FF5A00] hover:text-[#FFFFFF] disabled:opacity-40"
                  >
                    {pendingKey === 'takeCase' && <Loader2 className="size-3.5 animate-spin" />}
                    Take case
                  </button>
                )}
              </div>

              {!canRule ? (
                <p className="text-xs text-[var(--p2p-muted)]">
                  {!arbiterTimeReady
                    ? `Arbiter action from Paid unlocks 15 minutes after markPaid (${formatDuration(paid15mLeft)} remaining).`
                    : `Backup arbiter window opens in ${formatDaysHours(backupWaitLeft)}.`}
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--p2p-muted)]">
                    <input
                      type="checkbox"
                      checked={applyBond}
                      onChange={(e) => setApplyBond(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
                    />
                    <span>
                      Charge <strong className="p2p-mono text-[var(--p2p-ink)]">{formatUsdcAmount(order.bond)} USDC</strong> dispute bond to the losing party (from free margin first, shortfall recorded as debt).
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--p2p-muted)]">
                    <input
                      type="checkbox"
                      checked={slash}
                      onChange={(e) => setSlash(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
                    />
                    <span>
                      Also slash extra merchant margin from the losing party (up to {formatUsdcAmount(order.amount)} USDC).
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resolve(true)}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[#FF5A00] px-3 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
                    >
                      {pendingKey === 'resolveBuyer' && <Loader2 className="size-3.5 animate-spin" />}
                      Release to Buyer
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resolve(false)}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[#FF5A00] bg-transparent px-3 text-xs font-bold text-[#FF5A00] hover:bg-[var(--p2p-tint)] disabled:opacity-40"
                    >
                      {pendingKey === 'resolveSeller' && <Loader2 className="size-3.5 animate-spin" />}
                      Return to Seller
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TERMINAL OUTCOME BANNERS */}
          {(status === STATUS.COMPLETED ||
            status === STATUS.CANCELLED ||
            status === STATUS.RESOLVED_BUYER ||
            status === STATUS.RESOLVED_SELLER ||
            status === STATUS.SETTLED) && (
            <div className="p2p-card flex items-center gap-3 rounded-xl !border-[var(--p2p-border-active)] p-4 text-sm font-semibold text-[var(--p2p-ink)]">
              <Check className="size-5 shrink-0 text-[#FF5A00]" />
              <span>
                {status === STATUS.COMPLETED && `Order completed — ${formatUsdcAmount(order.amount)} USDC released to buyer.`}
                {status === STATUS.CANCELLED && 'Order cancelled — escrowed USDC returned.'}
                {status === STATUS.RESOLVED_BUYER && 'Dispute resolved by arbiter — USDC released to buyer.'}
                {status === STATUS.RESOLVED_SELLER && 'Dispute resolved by arbiter — USDC returned to seller.'}
                {status === STATUS.SETTLED && 'Dispute settled directly by parties — zero bond charged.'}
              </span>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (40% — Desktop Only; Mobile uses Full-Screen Slide-Over Chat Drawer) */}
        <div className="hidden md:sticky md:top-28 md:block">
          <OrderChat
            orderId={order.id}
            buyer={order.buyer}
            seller={order.seller}
            canPost={canPostChat}
            orderStatus={status}
            amountText={formatUsdcAmount(order.amount)}
          />
        </div>
      </div>

      {/* =====================================================================
          MOBILE STICKY THUMB-ZONE BOTTOM ACTION BAR (< 768px)
         ===================================================================== */}
      {status === STATUS.PENDING && isBuyer && (
        <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-[3fr_7fr] gap-2.5 border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-3 backdrop-blur-2xl md:hidden">
          <button
            type="button"
            disabled={busy}
            onClick={() => void callSimple('cancelOrder', 'Cancel order')}
            className="h-12 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-xs font-bold text-[var(--p2p-ink)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!payerReady || hardExpired || busy}
            onClick={() => void callMarkPaid()}
            className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold text-[#FFFFFF] disabled:opacity-40 ${
              pastDeadline ? 'bg-red-600' : 'bg-[#FF5A00]'
            }`}
          >
            {pendingKey === 'markPaid' && <Loader2 className="size-4 animate-spin" />}
            {pastDeadline ? 'Mark Paid + Transfer ID' : 'Transferred, Notify Seller'}
          </button>
        </div>
      )}

      {status === STATUS.PENDING && !isBuyer && (isSeller || hardExpired) && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-3 backdrop-blur-2xl md:hidden">
          {isSeller && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void callSimple('release', 'Release USDC')}
              className="h-12 flex-1 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-xs font-bold text-[var(--p2p-ink)]"
            >
              Release Early
            </button>
          )}
          {hardExpired && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void callSimple('cancelOrder', 'Cancel expired order')}
              className="h-12 flex-1 rounded-xl bg-[#FF5A00] text-xs font-bold text-[#FFFFFF]"
            >
              Cancel Expired
            </button>
          )}
        </div>
      )}

      {status === STATUS.PAID && isSeller && (
        <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-[3fr_7fr] gap-2.5 border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-3 backdrop-blur-2xl md:hidden">
          <button
            type="button"
            disabled={busy}
            onClick={() => void callSimple('openDispute', 'Open dispute')}
            className="h-12 rounded-xl border border-[#FF5A00] bg-transparent text-xs font-bold text-[#FF5A00] disabled:opacity-40"
          >
            Dispute
          </button>
          <button
            type="button"
            disabled={busy || !confirmed}
            onClick={() => void callSimple('release', 'Release USDC')}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
          >
            {pendingKey === 'release' && <Loader2 className="size-4 animate-spin" />}
            Release USDC
          </button>
        </div>
      )}

      {status === STATUS.PAID && isBuyer && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-3 backdrop-blur-2xl md:hidden">
          <button
            type="button"
            disabled={!canBuyerDispute || busy}
            onClick={() => void callSimple('openDispute', 'Open dispute')}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#FF5A00] bg-[var(--p2p-tint)] text-xs font-bold text-[#FF5A00] disabled:opacity-40"
          >
            {pendingKey === 'openDispute' && <Loader2 className="size-4 animate-spin" />}
            {canBuyerDispute ? 'Open Dispute' : `Dispute Unlocks in ${formatDuration(disputeWaitLeft)}`}
          </button>
        </div>
      )}

      {status === STATUS.DISPUTED && (isSeller || isBuyer) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--p2p-border)] bg-[var(--p2p-bar)] px-4 py-3 backdrop-blur-2xl md:hidden">
          {isSeller ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void callSimple('release', 'Settle & release to buyer', 'settleRelease')}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5A00] text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
            >
              <Handshake className="size-4" /> Settle Dispute — Release USDC
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void callSimple('cancelOrder', 'Settle & cancel dispute', 'settleCancel')}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5A00] text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
            >
              <Handshake className="size-4" /> Settle Dispute — Cancel &amp; Return
            </button>
          )}
        </div>
      )}

      {/* =====================================================================
          MOBILE FULL-SCREEN SLIDE-OVER CHAT & EVIDENCE DRAWER (< 768px)
         ===================================================================== */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {mobileChatOpen && (
              <motion.div
                className="p2p-terminal fixed inset-0 z-50 md:hidden"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              >
                <OrderChat
                  orderId={order.id}
                  buyer={order.buyer}
                  seller={order.seller}
                  canPost={canPostChat}
                  orderStatus={status}
                  amountText={formatUsdcAmount(order.amount)}
                  onBackToOrder={() => {
                    setSeenMessages(totalMessages)
                    setMobileChatOpen(false)
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
