import { useState } from 'react'
import { useAccount } from 'wagmi'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  MARGIN_DELAY_DAYS,
  MERCHANT_MARGIN,
  formatDuration,
  formatUsdcAmount,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { useNow, useUsdcAllowance, useUsdcBalance } from '@/hooks/useEscrow'
import { useEligibility } from '@/hooks/useEligibility'
import { useTx } from '@/hooks/useTx'
import { Button, Empty, Field, inputClass } from '@/components/ui'

const parse = (v: string): bigint => {
  try {
    return v ? parseUnitsExact(v, 6) : 0n
  } catch {
    return 0n
  }
}

export function AccountPanel() {
  const { isConnected } = useAccount()
  const { account, blocked } = useEligibility()
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const now = useNow()
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()
  const [deposit, setDeposit] = useState('')
  const [withdraw, setWithdraw] = useState('')

  if (!isConnected) return <Empty title="Connect your wallet" body="Your trust profile and merchant margin live here." />
  if (!account || !ESCROW_ADDRESS) return <div className="glass h-48 animate-pulse rounded-3xl" />

  const escrow = ESCROW_ADDRESS
  const base = { address: escrow, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const
  const depositRaw = parse(deposit)
  const withdrawRaw = parse(withdraw)
  const pending = account.pendingWithdrawal
  const unlockIn = Number(account.withdrawalUnlockAt) - now
  const rate = account.ordersCreated > 0 ? Math.round((account.ordersCompleted / account.ordersCreated) * 100) : null

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
  const doRequest = async () => {
    const ok = await run('request', 'Request withdrawal', () =>
      writeContractAsync({ ...base, functionName: 'requestMarginWithdrawal', args: [withdrawRaw] }),
    )
    if (ok) setWithdraw('')
  }

  const stat = (label: string, value: string, tone?: string) => (
    <div>
      <p className="text-xs uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
        {label}
      </p>
      <p className="display text-2xl font-bold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  )

  return (
    <div className="space-y-5">
      <section className="glass rounded-3xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-4" style={{ color: 'var(--accent)' }} />
          <h2 className="display text-lg font-semibold">Trust profile</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stat('Trades', String(account.ordersCompleted))}
          {stat('Completion', rate === null ? 'None yet' : `${rate}%`)}
          {stat('Volume', `${formatUsdcAmount(account.volume, 0)}`)}
          {stat('Disputes lost', String(account.disputesLost), account.disputesLost > 0 ? 'var(--danger)' : undefined)}
        </div>
        <p className="mt-4 text-xs" style={{ color: blocked ? 'var(--danger)' : 'var(--subtle)' }}>
          {blocked ?? 'Your account is in good standing. Trades count once per distinct counterparty, for orders of 10 USDC or more.'}
        </p>
        {account.strikes > 0 && (
          <p className="mt-1 text-xs" style={{ color: 'var(--warn)' }}>
            Cancellation strikes: {account.strikes} of 3 in the current 24-hour window.
          </p>
        )}
      </section>

      <section className="glass rounded-3xl p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="display text-lg font-semibold">Merchant security margin</h2>
          {account.merchant && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold"
              style={{ background: 'rgba(141,216,159,0.14)', color: 'var(--success)' }}
            >
              <BadgeCheck className="size-3.5" /> Merchant
            </span>
          )}
        </div>
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Lock at least {formatUsdcAmount(MERCHANT_MARGIN, 0)} USDC to earn a Merchant badge on your ads. If the arbiter
          rules against you, part of this margin can be paid to the other trader. Withdrawals take {MARGIN_DELAY_DAYS} days
          and are blocked while you have open orders.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          {stat('Margin', `${formatUsdcAmount(account.margin)} USDC`)}
          {stat('Counts for badge', `${formatUsdcAmount(account.effectiveMargin)} USDC`)}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Field label="Deposit USDC" hint={balance !== undefined ? `Balance ${formatUsdcAmount(balance)} USDC` : undefined}>
              <input
                inputMode="decimal"
                value={deposit}
                onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setDeposit(e.target.value)}
                placeholder="100"
                className={inputClass}
              />
            </Field>
            <Button
              className="w-full"
              disabled={depositRaw === 0n || (balance !== undefined && depositRaw > balance)}
              loading={pendingKey === 'deposit' || pendingKey === 'approve'}
              onClick={() => void doDeposit()}
            >
              Deposit margin
            </Button>
          </div>

          <div className="space-y-2">
            {pending === 0n ? (
              <>
                <Field label="Withdraw USDC" hint={`Available after a ${MARGIN_DELAY_DAYS}-day wait`}>
                  <input
                    inputMode="decimal"
                    value={withdraw}
                    onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setWithdraw(e.target.value)}
                    placeholder="0.00"
                    className={inputClass}
                  />
                </Field>
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={withdrawRaw === 0n || withdrawRaw > account.margin}
                  loading={pendingKey === 'request'}
                  onClick={() => void doRequest()}
                >
                  Request withdrawal
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold tabular-nums">
                  Pending withdrawal: {formatUsdcAmount(pending)} USDC
                </p>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  {unlockIn > 0 ? `Unlocks in ${formatDuration(unlockIn)}` : 'Ready to withdraw'}
                  {account.partyOpen > 0n && ' · blocked while you have open orders'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    disabled={unlockIn > 0 || account.partyOpen > 0n || busy}
                    loading={pendingKey === 'complete'}
                    onClick={() =>
                      void run('complete', 'Withdraw margin', () =>
                        writeContractAsync({ ...base, functionName: 'completeMarginWithdrawal' }),
                      )
                    }
                  >
                    Withdraw
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    loading={pendingKey === 'cancelReq'}
                    onClick={() =>
                      void run('cancelReq', 'Cancel request', () =>
                        writeContractAsync({ ...base, functionName: 'cancelMarginWithdrawal' }),
                      )
                    }
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
