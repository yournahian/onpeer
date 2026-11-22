import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, CreditCard, Loader2, ShieldCheck, UserCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  MARGIN_DELAY_DAYS,
  MERCHANT_MARGIN,
  TIER_TABLE,
  formatDuration,
  formatOrderCap,
  formatUsdcAmount,
  shortAddr,
} from '@/lib/p2p'
import { formatUnitsFixed, parseUnitsExact } from '@/onchain-money'
import { useDebts, useNow, useUsdcAllowance, useUsdcBalance } from '@/hooks/useEscrow'
import { useEligibility } from '@/hooks/useEligibility'
import { useSavedPaymentMethods } from '@/hooks/useAccount'
import { useTx } from '@/hooks/useTx'
import { AccountSetup } from '@/components/AccountSetup'
import { KycPanel } from '@/components/KycPanel'
import { PaymentMethodsPanel } from '@/components/PaymentMethodsPanel'

type AccountSubTab = 'payments' | 'profile' | 'margin'

const parse = (v: string): bigint => {
  try {
    return v ? parseUnitsExact(v, 6) : 0n
  } catch {
    return 0n
  }
}

export function AccountPanel() {
  const { address, isConnected } = useAccount()
  const { account, blocked, kyc, kycRequired } = useEligibility()
  const { methods: savedMethods } = useSavedPaymentMethods()
  const debts = useDebts(address)
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const now = useNow()
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()
  const [subTab, setSubTab] = useState<AccountSubTab>(() => {
    if (typeof window !== 'undefined') {
      const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const sp = new URLSearchParams(window.location.search)
      if (hp.has('verify_email') || hp.has('unsubscribe') || hp.has('kyc_return') || sp.has('kyc_return')) {
        return 'profile'
      }
    }
    return 'payments'
  })
  const [deposit, setDeposit] = useState('')
  const [withdraw, setWithdraw] = useState('')
  const [repay, setRepay] = useState('')

  const subTabs: { id: AccountSubTab; label: string; icon: typeof CreditCard; badge?: number }[] = [
    { id: 'payments', label: 'Payment Methods', icon: CreditCard, badge: savedMethods.length },
    { id: 'profile', label: 'Profile & KYC', icon: UserCheck },
    { id: 'margin', label: 'Margin & Tier', icon: ShieldCheck },
  ]

  if (!isConnected) {
    return (
      <div className="p2p-card rounded-xl px-6 py-14 text-center">
        <p className="text-base font-bold text-[var(--p2p-ink)]">Connect Your Wallet</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--p2p-muted)]">
          Inspect your account tier, stake 100 USDC Merchant Margin, or repay unpaid dispute bonds.
        </p>
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              type="button"
              onClick={show}
              className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
            >
              Connect Wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    )
  }

  if (!account || !ESCROW_ADDRESS) {
    return (
      <div className="space-y-5">
        <PaymentMethodsPanel />
        <AccountSetup />
        <KycPanel />
        <div className="p2p-card rounded-xl px-5 py-6 text-xs text-[var(--p2p-muted)]">
          Loading onchain trust tier and merchant margin from Arc Testnet...
        </div>
      </div>
    )
  }

  const escrow = ESCROW_ADDRESS
  const base = { address: escrow, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
  const depositRaw = parse(deposit)
  const withdrawRaw = parse(withdraw)
  const repayRaw = repay ? parse(repay) : account.totalDebt
  const effectiveRepay = repayRaw > account.totalDebt ? account.totalDebt : repayRaw
  const pending = account.pendingWithdrawal
  const unlockIn = Number(account.withdrawalUnlockAt) - now
  const rate = account.ordersCreated > 0 ? ((account.ordersCompleted / account.ordersCreated) * 100).toFixed(2) : null
  const tierMeta = TIER_TABLE[account.tier] ?? TIER_TABLE[0]

  const doDeposit = async () => {
    if ((allowance ?? 0n) < depositRaw) {
      const ok = await approveUsdc(depositRaw)
      if (!ok) return
    }
    const ok = await run('deposit', 'Deposit margin', () =>
      writeContractAsync({ ...base, functionName: 'depositMargin', args: [depositRaw] }),
    )
    if (ok) setDeposit('')
  }

  const doRepay = async () => {
    if (effectiveRepay === 0n) return
    if ((allowance ?? 0n) < effectiveRepay) {
      const ok = await approveUsdc(effectiveRepay)
      if (!ok) return
    }
    const ok = await run('repayDebt', 'Repay dispute bond debt', () =>
      writeContractAsync({ ...base, functionName: 'repayDebt', args: [effectiveRepay] }),
    )
    if (ok) setRepay('')
  }

  const doRequest = async () => {
    const ok = await run('request', 'Request withdrawal', () =>
      writeContractAsync({ ...base, functionName: 'requestMarginWithdrawal', args: [withdrawRaw] }),
    )
    if (ok) setWithdraw('')
  }

  return (
    <div className="space-y-5">
      {/* Sub-navigation: Payment Methods | Profile & KYC | Margin & Tier */}
      <div
        role="tablist"
        aria-label="Account sections"
        className="flex gap-1.5 overflow-x-auto rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-1.5"
      >
        {subTabs.map((t) => {
          const active = subTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(t.id)}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-xs font-bold transition-colors sm:text-sm ${
                active
                  ? 'bg-[#FF5A00] text-[#FFFFFF]'
                  : 'text-[var(--p2p-muted)] hover:bg-[var(--p2p-input-bg)] hover:text-[var(--p2p-ink)]'
              }`}
            >
              <t.icon className="size-4 shrink-0" />
              <span>{t.label}</span>
              {!!t.badge && (
                <span
                  className={`p2p-mono rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                    active ? 'bg-white/25 text-white' : 'bg-[#FF5A00] text-white'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {account.totalDebt > 0n && (
        <section className="p2p-card rounded-xl !border-[#FF5A00] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#FF5A00]">
              <AlertTriangle className="size-4" />
              Unpaid Dispute Bond: <span className="p2p-mono">{formatUsdcAmount(account.totalDebt)} USDC</span>
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--p2p-muted)]">
            New ads and new orders are locked until this dispute bond debt is repaid. Existing orders and withdrawals remain available.
          </p>

          {debts.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {debts.map((d, idx) => (
                <li
                  key={`${d.creditor}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-2"
                >
                  <span className="text-[var(--p2p-muted)]">
                    Creditor <span className="p2p-mono text-[var(--p2p-ink)]">{shortAddr(d.creditor)}</span>
                  </span>
                  <span className="p2p-mono font-bold text-[#FF5A00]">{formatUsdcAmount(d.amount)} USDC</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Amount to Repay (USDC)
              </span>
              <input
                inputMode="decimal"
                value={repay}
                onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setRepay(e.target.value)}
                placeholder={formatUnitsFixed(account.totalDebt, 6, 2)}
                className="p2p-input p2p-mono h-11 w-full rounded-lg px-3 text-sm font-bold"
              />
            </label>
            <button
              type="button"
              disabled={effectiveRepay === 0n || (balance !== undefined && effectiveRepay > balance) || busy}
              onClick={() => void doRepay()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
            >
              {(pendingKey === 'repayDebt' || pendingKey === 'approve') && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Repay {formatUsdcAmount(effectiveRepay)} USDC
            </button>
          </div>
        </section>
      )}

      {subTab === 'payments' && <PaymentMethodsPanel />}

      {subTab === 'profile' && (
        <div className="space-y-5">
          <AccountSetup />
          <KycPanel />
        </div>
      )}

      {subTab === 'margin' && (
        <div className="space-y-5">
      {/* Merchant Security Margin Card */}
      <section className="p2p-card rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p2p-border)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--p2p-ink)]">Merchant Security Margin</h2>
              {account.merchant && (
                <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
                  <ShieldCheck className="size-3.5" /> Verified Merchant
                </span>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[var(--p2p-muted)]">
              Stake <strong className="text-[var(--p2p-ink)]">{formatUsdcAmount(MERCHANT_MARGIN, 0)} USDC</strong> or more to earn the Merchant Shield, unlock Buy Ads immediately, and receive at least the 500 USDC per-order tier. Withdrawals have a {MARGIN_DELAY_DAYS}-day timelock and require zero open orders.
            </p>
          </div>

          <div className="flex gap-4 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-2.5">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">
                Total Margin
              </span>
              <span className="p2p-mono text-base font-bold text-[var(--p2p-ink)]">
                {formatUsdcAmount(account.margin)} USDC
              </span>
            </div>
            <div className="border-l border-[var(--p2p-border)] pl-4">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">
                Free Margin
              </span>
              <span className="p2p-mono text-base font-bold text-[#FF5A00]">
                {formatUsdcAmount(account.effectiveMargin)} USDC
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--p2p-ink)]">Stake USDC Margin</span>
              {balance !== undefined && (
                <span className="p2p-mono text-[var(--p2p-muted)]">
                  Wallet: {formatUsdcAmount(balance)} USDC
                </span>
              )}
            </div>
            <div className="p2p-input flex items-center rounded-lg !bg-[var(--p2p-surface-solid)] px-3 py-2.5">
              <input
                inputMode="decimal"
                value={deposit}
                onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setDeposit(e.target.value)}
                placeholder="100.00"
                className="p2p-mono w-full bg-transparent text-sm font-bold text-[var(--p2p-ink)] outline-none"
              />
              <button
                type="button"
                onClick={() => setDeposit('100')}
                className="mr-2 text-xs font-bold text-[#FF5A00]"
              >
                100
              </button>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--p2p-ink)]">
                <TokenUSDC variant="branded" size={14} /> USDC
              </span>
            </div>
            <button
              type="button"
              disabled={depositRaw === 0n || (balance !== undefined && depositRaw > balance) || busy}
              onClick={() => void doDeposit()}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
            >
              {(pendingKey === 'deposit' || pendingKey === 'approve') && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Deposit Margin
            </button>
          </div>

          <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
            {pending === 0n ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--p2p-ink)]">Request Margin Withdrawal</span>
                  <span className="text-[var(--p2p-muted)]">{MARGIN_DELAY_DAYS}-day cooldown</span>
                </div>
                <div className="p2p-input flex items-center rounded-lg !bg-[var(--p2p-surface-solid)] px-3 py-2.5">
                  <input
                    inputMode="decimal"
                    value={withdraw}
                    onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setWithdraw(e.target.value)}
                    placeholder="0.00"
                    className="p2p-mono w-full bg-transparent text-sm font-bold text-[var(--p2p-ink)] outline-none"
                  />
                  <span className="text-xs font-bold text-[var(--p2p-ink)]">USDC</span>
                </div>
                <button
                  type="button"
                  disabled={withdrawRaw === 0n || withdrawRaw > account.margin || busy}
                  onClick={() => void doRequest()}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-4 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00] disabled:opacity-40"
                >
                  {pendingKey === 'request' && <Loader2 className="size-3.5 animate-spin" />}
                  Request Withdrawal
                </button>
              </>
            ) : (
              <div className="flex h-full flex-col justify-between space-y-3">
                <div>
                  <p className="p2p-mono text-sm font-bold text-[var(--p2p-ink)]">
                    Queued: {formatUsdcAmount(pending)} USDC
                  </p>
                  <p className="mt-1 text-xs text-[var(--p2p-muted)]">
                    {unlockIn > 0 ? `Unlocks in ${formatDuration(unlockIn)}` : 'Unlocked — ready to withdraw'}
                    {account.partyOpen > 0n && ' • Finish open orders first'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={unlockIn > 0 || account.partyOpen > 0n || busy}
                    onClick={() =>
                      void run('complete', 'Withdraw margin', () =>
                        writeContractAsync({ ...base, functionName: 'completeMarginWithdrawal' }),
                      )
                    }
                    className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#FF5A00] px-3 text-xs font-bold text-[#FFFFFF] disabled:opacity-40"
                  >
                    Withdraw
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run('cancelReq', 'Cancel request', () =>
                        writeContractAsync({ ...base, functionName: 'cancelMarginWithdrawal' }),
                      )
                    }
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-3 text-xs font-semibold text-[var(--p2p-ink)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Trust Profile & Tier Caps */}
      <section className="p2p-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[var(--p2p-ink)]">Account Standing &amp; Order Tier</h2>
          <span className="p2p-mono rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2.5 py-1 text-xs font-bold text-[#FF5A00]">
            Tier {account.tier}: {tierMeta.label} • Cap {formatOrderCap(account.orderCap)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
          {[
            ['Completed', String(account.ordersCompleted)],
            ['Completion Rate', rate === null ? '—' : `${rate}%`],
            ['Volume', `${formatUsdcAmount(account.volume, 0)} USDC`],
            ['Per-Order Cap', formatOrderCap(account.orderCap)],
            [
              'KYC Status',
              kyc.verified
                ? `Verified L${kyc.level}`
                : kycRequired
                  ? 'Required (Unverified)'
                  : 'Off / Optional',
            ],
            ['Concessions', `${account.concessions} (2 = 1 loss)`],
            ['Lost Disputes', String(account.disputesLost)],
            ['Late Marks (30d)', `${account.lateMarks} / 2`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">{k}</span>
              <span className="p2p-mono mt-1 block text-base font-bold text-[var(--p2p-ink)]">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
          {TIER_TABLE.map((t) => {
            const current = account.tier === t.tier
            return (
              <div
                key={t.tier}
                className={`rounded-lg border p-3 text-xs ${
                  current
                    ? 'border-[#FF5A00] bg-[var(--p2p-tint)]'
                    : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)]'
                }`}
              >
                <p className={`font-bold ${current ? 'text-[#FF5A00]' : 'text-[var(--p2p-ink)]'}`}>
                  Tier {t.tier} • {t.label}
                </p>
                <p className="p2p-mono mt-0.5 font-semibold text-[var(--p2p-ink)]">
                  {t.cap === null ? 'Uncapped' : `${formatUsdcAmount(t.cap, 0)} USDC`}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--p2p-muted)]">{t.requirement}</p>
              </div>
            )
          })}
        </div>

        <p className="mt-3 text-xs text-[var(--p2p-muted)]">
          {blocked ? (
            <span className="font-semibold text-[#FF5A00]">{blocked}</span>
          ) : (
            'Account in good standing. Completed trades count once per distinct counterparty for orders >= 10 USDC.'
          )}
          {account.strikes > 0 && ` • Cancellation strikes (24h): ${account.strikes}/3`}
        </p>
      </section>
        </div>
      )}
    </div>
  )
}
