import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  ExternalLink,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { isAddress, type Address } from 'viem'
import { useAccount, useSignMessage } from 'wagmi'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  CHAIN_ID,
  P2P_ASSETS,
  SIDE_BUY,
  STATUS,
  STATUS_META,
  TIER_TABLE,
  VISIBLE_P2P_ASSETS,
  formatDuration,
  formatFiat,
  formatOrderCap,
  formatPrice,
  formatUsdcAmount,
  getEscrowConfig,
  hexToCurrency,
  isAdExpired,
  sameAddr,
  shortAddr,
  type P2pAsset,
} from '@/lib/p2p'
import { apiFetch, signInWithWallet, useBackendSession } from '@/lib/api'
import {
  useAccounts,
  useAllAds,
  useDebts,
  useDisputeWaived,
  useNow,
  useOrders,
  useVerifications,
  type Account,
  type AdWithId,
  type KycInfo,
  type OrderWithId,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Avatar, Button, CopyButton, Empty, inputClass } from '@/components/ui'
import { CoinLogo } from '@/components/logos'

interface AdminDirectoryUser {
  wallet: Address
  displayName: string | null
  kycLegalName: string | null
  country: string | null
  emailMasked: string | null
  emailVerified: boolean
  emailOptIn: boolean
  telegramLinked: boolean
  telegramOptIn: boolean
  kycStatus: string
  kycLevel: number
  kycExpiresAt: string | null
  disputesFiled: number
  createdAt: string | null
  deletedAt: string | null
}

interface UserHistorySummary {
  totalOrders: number
  completedOrders: number
  cancelledOrders: number
  activeOrders: number
  disputesTotal: number
  disputesWon: number
  disputesLostOrders: number
  adsCount: number
  orders: OrderWithId[]
  ads: AdWithId[]
}

const EMPTY_HISTORY: UserHistorySummary = {
  totalOrders: 0,
  completedOrders: 0,
  cancelledOrders: 0,
  activeOrders: 0,
  disputesTotal: 0,
  disputesWon: 0,
  disputesLostOrders: 0,
  adsCount: 0,
  orders: [],
  ads: [],
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="inner rounded-xl p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
        {label}
      </p>
      <p className="display mt-0.5 text-lg font-bold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  )
}

function formatDateShort(isoOrSec: string | number | bigint | null | undefined): string {
  if (isoOrSec === null || isoOrSec === undefined) return '—'
  const ms = typeof isoOrSec === 'string' ? Date.parse(isoOrSec) : Number(isoOrSec) * 1000
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function RestrictedRow({
  address,
  profile,
  account,
  asset,
  applyAllAssets,
  canWrite,
  onInspect,
}: {
  address: Address
  profile?: AdminDirectoryUser
  account: Account
  asset: P2pAsset
  applyAllAssets: boolean
  canWrite: boolean
  onInspect: (addr: Address) => void
}) {
  const now = useNow()
  const waived = useDisputeWaived(address, asset)
  const { run, writeContractAsync, pendingKey } = useTx(asset)
  const bannedLeft = Number(account.bannedUntil) - now
  const targets = applyAllAssets
    ? P2P_ASSETS.map((a) => getEscrowConfig(a).escrowAddress)
    : [getEscrowConfig(asset).escrowAddress]

  const liftAdminRestrict = () =>
    run(`row-restrict-${address}`, 'Lift account restriction', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setRestricted',
          args: [address, false],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  const waiveDisputeLimit = () =>
    run(`row-waiver-${address}`, 'Turn off lost-dispute restriction', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setDisputeWaiver',
          args: [address, true],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  const primaryName = profile?.kycLegalName || profile?.displayName || shortAddr(address)

  return (
    <li className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar address={address} size={38} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onInspect(address)}
              className="text-left text-sm font-bold hover:underline"
            >
              {primaryName}
            </button>
            <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>
              {shortAddr(address)}
            </span>
            <CopyButton text={address} label="Copy" />
            {account.restricted && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                Admin Restricted
              </span>
            )}
            {account.disputeLimitReached && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                Dispute Limit ({account.disputesLost} lost)
              </span>
            )}
            {account.totalDebt > 0n && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                Debt: {formatUsdcAmount(account.totalDebt, undefined, asset)} {asset}
              </span>
            )}
            {bannedLeft > 0 && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                Cooldown ({formatDuration(bannedLeft)})
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            {account.disputeLimitReached || account.restricted
              ? 'Blocked from opening new trades.'
              : account.totalDebt > 0n
                ? 'Blocked until user repays their unpaid dispute bond.'
                : 'Temporarily in 24h cancellation cooldown.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canWrite && account.disputeLimitReached && !waived && (
          <Button
            variant="buy"
            loading={pendingKey === `row-waiver-${address}`}
            onClick={() => void waiveDisputeLimit()}
          >
            <ShieldCheck className="size-4" /> Turn Off Dispute Restriction
          </Button>
        )}
        {canWrite && account.restricted && (
          <Button
            variant="buy"
            loading={pendingKey === `row-restrict-${address}`}
            onClick={() => void liftAdminRestrict()}
          >
            <ShieldCheck className="size-4" /> Lift Restriction
          </Button>
        )}
        <Button variant="ghost" onClick={() => onInspect(address)}>
          View Profile
        </Button>
      </div>
    </li>
  )
}

function AccountDetailProfile({
  address,
  profile,
  account,
  history,
  asset,
  applyAllAssets,
  kyc,
  canWrite,
  canRevokeKyc,
  onClose,
}: {
  address: Address
  profile?: AdminDirectoryUser
  account?: Account
  history: UserHistorySummary
  asset: P2pAsset
  applyAllAssets: boolean
  kyc?: KycInfo
  canWrite: boolean
  canRevokeKyc: boolean
  onClose: () => void
}) {
  const now = useNow()
  const debts = useDebts(address, asset)
  const waived = useDisputeWaived(address, asset)
  const { run, writeContractAsync, pendingKey } = useTx(asset)
  const [historyTab, setHistoryTab] = useState<'orders' | 'ads'>('orders')

  const banned = account ? Number(account.bannedUntil) > now : false
  const tierMeta = TIER_TABLE[account?.tier ?? 0] ?? TIER_TABLE[0]
  const kycVerified = Boolean(kyc?.verified || profile?.kycStatus === 'approved')
  const kycText = kyc?.verified
    ? `Verified L${kyc.level}`
    : profile?.kycStatus === 'approved'
      ? `Approved L${profile.kycLevel || 2}`
      : profile?.kycStatus && profile.kycStatus !== 'none'
        ? profile.kycStatus.replace(/_/g, ' ')
        : kyc && kyc.level > 0
          ? `Expired (L${kyc.level})`
          : 'Unverified'

  const targets = applyAllAssets
    ? P2P_ASSETS.map((a) => getEscrowConfig(a).escrowAddress)
    : [getEscrowConfig(asset).escrowAddress]

  const flipRestrict = () => {
    if (!account) return
    return run(`restrict-${address}`, account.restricted ? 'Lift restriction' : 'Restrict account', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setRestricted',
          args: [address, !account.restricted],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })
  }

  const flipWaiver = () =>
    run(`waiver-${address}`, waived ? 'Reinstate dispute limit' : 'Waive dispute limit', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'setDisputeWaiver',
          args: [address, !waived],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  const revokeKyc = () =>
    run(`revoke-kyc-${address}`, 'Revoke KYC verification', async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const escrowAddr of targets) {
        lastHash = await writeContractAsync({
          address: escrowAddr,
          abi: p2pEscrowAbi,
          functionName: 'revokeVerification',
          args: [address],
          chainId: CHAIN_ID,
        })
      }
      return lastHash
    })

  const headingName = profile?.kycLegalName || profile?.displayName || shortAddr(address)
  const completedCount = Math.max(account?.ordersCompleted ?? 0, history.completedOrders)
  const disputesLostCount = Math.max(account?.disputesLost ?? 0, history.disputesLostOrders)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-3xl p-4 sm:p-6"
      style={{ border: '1px solid var(--accent)' }}
    >
      {/* Profile Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex min-w-0 items-start gap-3.5">
          <Avatar address={address} size={48} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold">{headingName}</h3>
              {profile?.kycLegalName && profile.displayName && profile.kycLegalName !== profile.displayName && (
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}>
                  Alias: {profile.displayName}
                </span>
              )}
              {profile?.deletedAt && (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                  Account Deleted
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="mono break-all" style={{ color: 'var(--subtle)' }}>
                {address}
              </span>
              <CopyButton text={address} label="Copy" />
              <a
                href={buildAddressExplorerUrl(CHAIN_ID, address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline"
                style={{ color: 'var(--accent)' }}
              >
                Explorer <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
              <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--text)' }}>
                {asset} · Tier {account?.tier ?? 0} ({tierMeta.label})
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5"
                style={{
                  background: 'var(--fill-3)',
                  color: kycVerified ? 'var(--success)' : 'var(--subtle)',
                }}
              >
                <UserCheck className="size-3" /> KYC: {kycText}
              </span>
              {profile?.country && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}>
                  Country: {profile.country}
                </span>
              )}
              {profile?.emailMasked && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}>
                  <Mail className="size-3" />
                  {profile.emailMasked}
                  {profile.emailVerified && <CheckCircle2 className="size-3" style={{ color: 'var(--success)' }} />}
                </span>
              )}
              {profile?.telegramLinked && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}>
                  <Send className="size-3" /> Telegram Linked
                </span>
              )}
              {profile?.createdAt && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
                  Joined {formatDateShort(profile.createdAt)}
                </span>
              )}
              {account?.merchant && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
                  Merchant
                </span>
              )}
              {account?.restricted && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                  Restricted
                </span>
              )}
              {account?.disputeLimitReached && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                  Dispute Limit Reached
                </span>
              )}
              {waived && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--success)' }}>
                  Dispute Limit Waived
                </span>
              )}
              {account && account.totalDebt > 0n && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                  Bond Debt Owed
                </span>
              )}
              {banned && (
                <span className="rounded-full px-2.5 py-0.5" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                  Cooldown ({formatDuration(Number(account!.bannedUntil) - now)})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canRevokeKyc && kyc && kyc.level > 0 && (
            <Button variant="ghost" loading={pendingKey === `revoke-kyc-${address}`} onClick={() => void revokeKyc()}>
              Revoke KYC
            </Button>
          )}
          {canWrite && account && (account.disputeLimitReached || waived) && (
            <Button
              variant={waived ? 'ghost' : 'buy'}
              loading={pendingKey === `waiver-${address}`}
              onClick={() => void flipWaiver()}
            >
              {waived ? 'Reinstate dispute limit' : 'Turn Off Dispute Restriction'}
            </Button>
          )}
          {canWrite && account && (
            <Button
              variant={account.restricted ? 'buy' : 'danger'}
              loading={pendingKey === `restrict-${address}`}
              onClick={() => void flipRestrict()}
            >
              {account.restricted ? 'Lift restriction' : 'Restrict account'}
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close user profile"
            className="inline-flex size-9 items-center justify-center rounded-xl transition-colors hover:bg-[var(--fill-3)]"
            style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Completed Trades" value={String(completedCount)} tone="var(--success)" />
        <Stat label="Total Orders" value={String(history.totalOrders)} />
        <Stat label="Disputes Total" value={String(Math.max(history.disputesTotal, profile?.disputesFiled ?? 0))} />
        <Stat label="Disputes Won" value={String(history.disputesWon)} tone="var(--success)" />
        <Stat label="Disputes Lost" value={String(disputesLostCount)} tone={disputesLostCount > 0 ? 'var(--danger)' : undefined} />
        <Stat label="Concessions" value={`${account?.concessions ?? 0} (2 = 1 loss)`} />
        <Stat label="Tier & Cap" value={`T${account?.tier ?? 0} · ${account ? formatOrderCap(account.orderCap, asset) : '—'}`} />
        <Stat label="Cancel Strikes" value={`${account?.strikes ?? 0} / 3`} />
        <Stat label="Late Marks (30d)" value={`${account?.lateMarks ?? 0} / 2`} />
        <Stat
          label="Unpaid Bond Debt"
          value={account ? `${formatUsdcAmount(account.totalDebt, undefined, asset)} ${asset}` : '0'}
          tone={account && account.totalDebt > 0n ? 'var(--warn)' : undefined}
        />
        <Stat
          label="Merchant Margin"
          value={account ? `${formatUsdcAmount(account.effectiveMargin, undefined, asset)} ${asset}` : '0'}
        />
        <Stat
          label={`Volume (${asset})`}
          value={account ? `${formatUsdcAmount(account.volume, undefined, asset)} ${asset}` : '0'}
        />
      </div>

      {(kyc?.expiry && kyc.expiry > 0n) || profile?.kycExpiresAt ? (
        <p className="mt-2.5 text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
          KYC expiry:{' '}
          {kyc && kyc.expiry > 0n
            ? new Date(Number(kyc.expiry) * 1000).toLocaleString()
            : profile?.kycExpiresAt
              ? new Date(profile.kycExpiresAt).toLocaleString()
              : '—'}
        </p>
      ) : null}

      {/* Itemized Debts */}
      {debts.length > 0 && (
        <div className="mt-4 rounded-2xl p-3.5 text-xs" style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}>
          <p className="font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
            Unpaid dispute bonds ({debts.length} / 8 slots)
          </p>
          <ul className="mt-2 space-y-1.5">
            {debts.map((d, idx) => (
              <li key={`${d.creditor}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <span>
                  Owed to <span className="mono">{shortAddr(d.creditor)}</span>
                </span>
                <span className="font-semibold" style={{ color: 'var(--warn)' }}>
                  {formatUsdcAmount(d.amount, undefined, asset)} {asset}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Historical Orders & Ads */}
      <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setHistoryTab('orders')}
              className="rounded-xl px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                background: historyTab === 'orders' ? 'var(--accent-bg)' : 'var(--fill-2)',
                color: historyTab === 'orders' ? 'var(--on-accent)' : 'var(--muted)',
              }}
            >
              Order History ({history.orders.length})
            </button>
            <button
              type="button"
              onClick={() => setHistoryTab('ads')}
              className="rounded-xl px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                background: historyTab === 'ads' ? 'var(--accent-bg)' : 'var(--fill-2)',
                color: historyTab === 'ads' ? 'var(--on-accent)' : 'var(--muted)',
              }}
            >
              Ads Posted ({history.ads.length})
            </button>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>
            Showing on-chain history across active markets
          </span>
        </div>

        {historyTab === 'orders' ? (
          history.orders.length === 0 ? (
            <p className="rounded-2xl p-4 text-center text-xs" style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
              No orders recorded for this user yet.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-left text-xs">
                <thead style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
                  <tr>
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Role</th>
                    <th className="px-3 py-2 font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Fiat</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Outcome</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {history.orders.map((o) => {
                    const isBuyer = sameAddr(o.buyer, address)
                    const meta = STATUS_META[o.status] ?? { label: 'Unknown', tone: 'neutral' }
                    const currency = hexToCurrency(o.currency)
                    const outcome =
                      o.status === STATUS.RESOLVED_BUYER
                        ? isBuyer
                          ? 'Won Dispute'
                          : 'Lost Dispute'
                        : o.status === STATUS.RESOLVED_SELLER
                          ? isBuyer
                            ? 'Lost Dispute'
                            : 'Won Dispute'
                          : o.status === STATUS.SETTLED
                            ? 'Party Settled'
                            : '—'
                    return (
                      <tr key={o.id.toString()} className="hover:bg-[var(--fill-2)]">
                        <td className="mono px-3 py-2 font-semibold">
                          #{o.rawId.toString()} ({o.asset})
                        </td>
                        <td className="px-3 py-2 font-semibold">{isBuyer ? 'Buyer' : 'Seller'}</td>
                        <td className="mono px-3 py-2 tabular-nums">
                          {formatUsdcAmount(o.amount, undefined, o.asset)} {o.asset}
                        </td>
                        <td className="mono px-3 py-2 tabular-nums">
                          {formatFiat(o.fiatAmountE6)} {currency}
                        </td>
                        <td className="px-3 py-2">{meta.label}</td>
                        <td
                          className="px-3 py-2 font-semibold"
                          style={{
                            color:
                              outcome === 'Won Dispute'
                                ? 'var(--success)'
                                : outcome === 'Lost Dispute'
                                  ? 'var(--danger)'
                                  : 'var(--subtle)',
                          }}
                        >
                          {outcome}
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--subtle)' }}>
                          {formatDateShort(o.createdAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : history.ads.length === 0 ? (
          <p className="rounded-2xl p-4 text-center text-xs" style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
            No ads posted by this user yet.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-2xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left text-xs">
              <thead style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}>
                <tr>
                  <th className="px-3 py-2 font-semibold">Ad</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Price</th>
                  <th className="px-3 py-2 font-semibold">Remaining / Total</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {history.ads.map((ad) => {
                  const currency = hexToCurrency(ad.currency)
                  const expired = isAdExpired(ad.expiresAt, now)
                  const adStatus = ad.closed ? 'Closed' : expired ? 'Expired' : 'Active'
                  return (
                    <tr key={ad.id.toString()} className="hover:bg-[var(--fill-2)]">
                      <td className="mono px-3 py-2 font-semibold">
                        #{ad.rawId.toString()} ({ad.asset})
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {ad.side === SIDE_BUY ? 'Buy Ad' : 'Sell Ad'}
                      </td>
                      <td className="mono px-3 py-2 tabular-nums">
                        {formatPrice(ad.priceE6)} {currency}
                      </td>
                      <td className="mono px-3 py-2 tabular-nums">
                        {formatUsdcAmount(ad.available, undefined, ad.asset)} / {formatUsdcAmount(ad.initialAmount, undefined, ad.asset)} {ad.asset}
                      </td>
                      <td className="px-3 py-2">{adStatus}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--subtle)' }}>
                        {formatDateShort(ad.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export function AccountsTab({ canWrite = true, canRevokeKyc = false }: { canWrite?: boolean; canRevokeKyc?: boolean }) {
  const { address: connectedWallet } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const session = useBackendSession()
  const [signingIn, setSigningIn] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<P2pAsset>('USDC')
  const [applyAllAssets, setApplyAllAssets] = useState(false)
  const [query, setQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'kyc' | 'traders' | 'flagged'>('all')
  const [selectedWallet, setSelectedWallet] = useState<Address | null>(null)
  const [dirUsers, setDirUsers] = useState<AdminDirectoryUser[]>([])
  const [dirLoading, setDirLoading] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  const { orders } = useOrders()
  const { ads } = useAllAds()
  const now = useNow()

  const loadDirectory = useCallback(async () => {
    if (!session) return
    setDirLoading(true)
    setDirError(null)
    try {
      const res = await apiFetch<{ users: AdminDirectoryUser[] }>('/admin/users')
      setDirUsers(res.users ?? [])
    } catch {
      setDirError('Sign in with an admin backend session (above) to load registered user names & KYC details.')
    } finally {
      setDirLoading(false)
    }
  }, [session])

  const handleSignIn = useCallback(async () => {
    if (!connectedWallet) return
    setSigningIn(true)
    setDirError(null)
    try {
      await signInWithWallet(connectedWallet, signMessageAsync)
    } catch {
      setDirError('Wallet sign-in was cancelled or failed. Try again to load registered users.')
    } finally {
      setSigningIn(false)
    }
  }, [connectedWallet, signMessageAsync])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void loadDirectory()
  }, [loadDirectory])

  const profileMap = useMemo(() => {
    const m = new Map<string, AdminDirectoryUser>()
    for (const u of dirUsers) {
      m.set(u.wallet.toLowerCase(), u)
    }
    return m
  }, [dirUsers])

  const historyMap = useMemo(() => {
    const m = new Map<string, UserHistorySummary>()
    const getOrCreate = (addr: string): UserHistorySummary => {
      const k = addr.toLowerCase()
      let cur = m.get(k)
      if (!cur) {
        cur = {
          totalOrders: 0,
          completedOrders: 0,
          cancelledOrders: 0,
          activeOrders: 0,
          disputesTotal: 0,
          disputesWon: 0,
          disputesLostOrders: 0,
          adsCount: 0,
          orders: [],
          ads: [],
        }
        m.set(k, cur)
      }
      return cur
    }

    for (const o of orders) {
      const parties: Array<{ addr: string; isBuyer: boolean }> = [
        { addr: o.buyer, isBuyer: true },
        { addr: o.seller, isBuyer: false },
      ]
      for (const p of parties) {
        const h = getOrCreate(p.addr)
        h.totalOrders += 1
        h.orders.push(o)
        if (o.status === STATUS.COMPLETED) h.completedOrders += 1
        else if (o.status === STATUS.CANCELLED) h.cancelledOrders += 1
        else if (o.status === STATUS.PENDING || o.status === STATUS.PAID || o.status === STATUS.DISPUTED) {
          h.activeOrders += 1
        }
        if (
          o.status === STATUS.DISPUTED ||
          o.status === STATUS.RESOLVED_BUYER ||
          o.status === STATUS.RESOLVED_SELLER ||
          o.status === STATUS.SETTLED
        ) {
          h.disputesTotal += 1
        }
        if (
          (o.status === STATUS.RESOLVED_BUYER && p.isBuyer) ||
          (o.status === STATUS.RESOLVED_SELLER && !p.isBuyer)
        ) {
          h.disputesWon += 1
        }
        if (
          (o.status === STATUS.RESOLVED_BUYER && !p.isBuyer) ||
          (o.status === STATUS.RESOLVED_SELLER && p.isBuyer)
        ) {
          h.disputesLostOrders += 1
        }
      }
    }

    for (const ad of ads) {
      const h = getOrCreate(ad.maker)
      h.adsCount += 1
      h.ads.push(ad)
    }

    return m
  }, [orders, ads])

  // Merge DB-registered users + on-chain participants so every user is visible
  const allWallets = useMemo(() => {
    const s = new Set<string>()
    for (const u of dirUsers) s.add(u.wallet.toLowerCase())
    for (const o of orders) {
      s.add(o.buyer.toLowerCase())
      s.add(o.seller.toLowerCase())
    }
    for (const a of ads) {
      s.add(a.maker.toLowerCase())
    }
    return Array.from(s) as Address[]
  }, [dirUsers, orders, ads])

  const trimmedQuery = query.trim()
  const directAddress = isAddress(trimmedQuery) ? (trimmedQuery.toLowerCase() as Address) : undefined

  const walletsToFetch = useMemo(() => {
    const list = [...allWallets]
    if (directAddress && !list.includes(directAddress)) list.unshift(directAddress)
    if (selectedWallet && !list.includes(selectedWallet.toLowerCase() as Address)) {
      list.unshift(selectedWallet.toLowerCase() as Address)
    }
    return list
  }, [allWallets, directAddress, selectedWallet])

  const accounts = useAccounts(walletsToFetch, selectedAsset)
  const verifications = useVerifications(walletsToFetch, selectedAsset)

  const blockedAccounts = allWallets.filter((a) => {
    const acc = accounts.get(a)
    return (
      acc &&
      (acc.restricted || acc.disputeLimitReached || acc.totalDebt > 0n || Number(acc.bannedUntil) > now)
    )
  })

  const filteredWallets = useMemo(() => {
    const q = trimmedQuery.toLowerCase()
    return walletsToFetch.filter((w) => {
      const prof = profileMap.get(w)
      const acc = accounts.get(w)
      const kyc = verifications.get(w)
      const hist = historyMap.get(w) ?? EMPTY_HISTORY

      if (filterMode === 'kyc') {
        if (!kyc?.verified && prof?.kycStatus !== 'approved') return false
      } else if (filterMode === 'traders') {
        if ((acc?.ordersCompleted ?? 0) === 0 && hist.totalOrders === 0 && hist.adsCount === 0) return false
      } else if (filterMode === 'flagged') {
        const isFlagged = Boolean(
          acc &&
            (acc.restricted ||
              acc.disputesLost > 0 ||
              acc.concessions > 0 ||
              acc.disputeLimitReached ||
              acc.totalDebt > 0n ||
              Number(acc.bannedUntil) > now),
        )
        if (!isFlagged) return false
      }

      if (!q) return true
      if (w.includes(q)) return true
      if (prof?.kycLegalName?.toLowerCase().includes(q)) return true
      if (prof?.displayName?.toLowerCase().includes(q)) return true
      if (prof?.emailMasked?.toLowerCase().includes(q)) return true
      if (prof?.country?.toLowerCase().includes(q)) return true
      return false
    })
  }, [walletsToFetch, trimmedQuery, filterMode, profileMap, accounts, verifications, historyMap, now])

  const inspectWallet = (addr: Address) => {
    setSelectedWallet(addr.toLowerCase() as Address)
    setTimeout(() => {
      profileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const activeWallet = selectedWallet ?? directAddress ?? null

  return (
    <div className="space-y-6">
      {/* Market Selector Bar */}
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {VISIBLE_P2P_ASSETS.map((a) => {
            const active = selectedAsset === a
            return (
              <button
                key={a}
                type="button"
                onClick={() => setSelectedAsset(a)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors"
                style={{
                  background: active ? 'var(--accent-bg)' : 'var(--fill-2)',
                  color: active ? 'var(--on-accent)' : 'var(--muted)',
                }}
              >
                <CoinLogo symbol={a} size={14} />
                <span>{a} Accounts</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canWrite && (
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={applyAllAssets}
                onChange={(e) => setApplyAllAssets(e.target.checked)}
                className="size-4"
              />
              <span>Apply actions across all markets</span>
            </label>
          )}
          <Button variant="ghost" onClick={() => void loadDirectory()} loading={dirLoading}>
            <RefreshCw className="size-3.5" /> Refresh Users
          </Button>
        </div>
      </div>

      {/* Selected User In-Details Profile */}
      {activeWallet && (
        <div ref={profileRef}>
          <AccountDetailProfile
            address={activeWallet}
            profile={profileMap.get(activeWallet)}
            account={accounts.get(activeWallet)}
            history={historyMap.get(activeWallet) ?? EMPTY_HISTORY}
            asset={selectedAsset}
            applyAllAssets={applyAllAssets}
            kyc={verifications.get(activeWallet)}
            canWrite={canWrite}
            canRevokeKyc={canRevokeKyc}
            onClose={() => setSelectedWallet(null)}
          />
        </div>
      )}

      {/* Restricted & Blocked Accounts */}
      {blockedAccounts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="size-4" style={{ color: 'var(--danger)' }} />
              Restricted &amp; Blocked Accounts on {selectedAsset} ({blockedAccounts.length})
            </h3>
          </div>
          <ul className="space-y-2.5">
            {blockedAccounts.map((a) => (
              <RestrictedRow
                key={`blocked-${selectedAsset}-${a}`}
                address={a}
                profile={profileMap.get(a)}
                account={accounts.get(a)!}
                asset={selectedAsset}
                applyAllAssets={applyAllAssets}
                canWrite={canWrite}
                onInspect={inspectWallet}
              />
            ))}
          </ul>
        </section>
      )}

      {/* All Users Directory */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4" style={{ color: 'var(--accent)' }} />
            All Users Directory ({filteredWallets.length} / {allWallets.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'All Users'],
                ['kyc', 'KYC Verified'],
                ['traders', 'Has Trades/Ads'],
                ['flagged', 'Flagged'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilterMode(id)}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: filterMode === id ? 'var(--accent-bg)' : 'var(--fill-2)',
                  color: filterMode === id ? 'var(--on-accent)' : 'var(--muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!session && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-xs"
            style={{ background: 'var(--fill-2)', border: '1px solid var(--border-strong)' }}
          >
            <span style={{ color: 'var(--muted)' }}>
              Sign in with your admin wallet to load registered accounts, KYC status, and offchain profiles.
            </span>
            <Button
              className="min-h-9 px-4 text-xs"
              loading={signingIn}
              disabled={!connectedWallet}
              onClick={() => void handleSignIn()}
            >
              Sign in to load users
            </Button>
          </div>
        )}

        {dirError && (
          <p className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--fill-2)', color: 'var(--warn)' }}>
            {dirError}
          </p>
        )}

        <div className="glass rounded-2xl p-3">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by KYC legal name, display alias, country, email, or 0x wallet address..."
              spellCheck={false}
              className={`${inputClass} pl-10 text-sm`}
            />
          </span>
        </div>

        {filteredWallets.length === 0 ? (
          <Empty
            title="No matching users"
            body="Try clearing the search filter or refreshing the user directory."
          />
        ) : (
          <div className="glass overflow-x-auto rounded-3xl">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b" style={{ borderColor: 'var(--border)', color: 'var(--subtle)' }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">User (KYC / Alias)</th>
                  <th className="px-3 py-3 font-semibold">KYC</th>
                  <th className="px-3 py-3 font-semibold">Trades</th>
                  <th className="px-3 py-3 font-semibold">Disputes (W / L)</th>
                  <th className="px-3 py-3 font-semibold">Margin / Debt</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {filteredWallets.map((w) => {
                  const prof = profileMap.get(w)
                  const acc = accounts.get(w)
                  const kyc = verifications.get(w)
                  const hist = historyMap.get(w) ?? EMPTY_HISTORY
                  const isSelected = activeWallet?.toLowerCase() === w
                  const kycOk = Boolean(kyc?.verified || prof?.kycStatus === 'approved')
                  const completed = Math.max(acc?.ordersCompleted ?? 0, hist.completedOrders)
                  const totalDisputes = Math.max(hist.disputesTotal, prof?.disputesFiled ?? 0)
                  const lost = Math.max(acc?.disputesLost ?? 0, hist.disputesLostOrders)
                  const bannedLeft = acc ? Number(acc.bannedUntil) - now : 0

                  return (
                    <tr
                      key={`${selectedAsset}-${w}`}
                      onClick={() => inspectWallet(w)}
                      className="cursor-pointer transition-colors hover:bg-[var(--fill-2)]"
                      style={isSelected ? { background: 'var(--fill-2)' } : undefined}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar address={w} size={32} />
                          <div className="min-w-0">
                            <p className="font-bold" style={{ color: 'var(--text)' }}>
                              {prof?.kycLegalName || prof?.displayName || shortAddr(w)}
                            </p>
                            <p className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
                              {prof?.kycLegalName && prof.displayName && (
                                <span>{prof.displayName} ·</span>
                              )}
                              <span className="mono">{shortAddr(w)}</span>
                              {prof?.country && <span>· {prof.country}</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold"
                          style={{
                            background: 'var(--fill-3)',
                            color: kycOk ? 'var(--success)' : 'var(--subtle)',
                          }}
                        >
                          {kycOk ? `Verified L${kyc?.level || prof?.kycLevel || 2}` : prof?.kycStatus && prof.kycStatus !== 'none' ? prof.kycStatus : 'None'}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <span className="font-bold">{completed}</span>
                        <span style={{ color: 'var(--subtle)' }}> / {hist.totalOrders} orders</span>
                        {hist.adsCount > 0 && (
                          <span className="block text-[11px]" style={{ color: 'var(--subtle)' }}>
                            {hist.adsCount} ads
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <span className="font-bold">{totalDisputes}</span>
                        <span className="ml-1.5" style={{ color: 'var(--success)' }}>
                          {hist.disputesWon}W
                        </span>
                        <span className="mx-1" style={{ color: 'var(--subtle)' }}>/</span>
                        <span style={{ color: lost > 0 ? 'var(--danger)' : 'var(--subtle)' }}>
                          {lost}L
                        </span>
                      </td>
                      <td className="mono px-3 py-3 tabular-nums">
                        {acc && acc.effectiveMargin > 0n ? (
                          <span className="block" style={{ color: 'var(--accent)' }}>
                            M: {formatUsdcAmount(acc.effectiveMargin, undefined, selectedAsset)}
                          </span>
                        ) : (
                          <span className="block" style={{ color: 'var(--subtle)' }}>—</span>
                        )}
                        {acc && acc.totalDebt > 0n && (
                          <span className="block font-bold" style={{ color: 'var(--warn)' }}>
                            Debt: {formatUsdcAmount(acc.totalDebt, undefined, selectedAsset)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {acc?.restricted && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                              Restricted
                            </span>
                          )}
                          {acc?.disputeLimitReached && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--danger)' }}>
                              Dispute Limit
                            </span>
                          )}
                          {bannedLeft > 0 && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--warn)' }}>
                              Cooldown
                            </span>
                          )}
                          {acc?.merchant && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--fill-3)', color: 'var(--accent)' }}>
                              Merchant
                            </span>
                          )}
                          {!acc?.restricted && !acc?.disputeLimitReached && bannedLeft <= 0 && !acc?.merchant && (
                            <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold" style={{ color: 'var(--accent)' }}>
                          Details →
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
