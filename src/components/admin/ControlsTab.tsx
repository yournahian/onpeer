import { useState } from 'react'
import { Coins, Lock, PauseCircle, PlayCircle, ShieldCheck, UserCheck, UserCog } from 'lucide-react'
import { useReadContracts } from 'wagmi'
import { isAddress, zeroAddress, type Address } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  COUNTRIES,
  ESCROW_ADDRESS,
  MAX_LISTING_FEE,
  currencyToHex,
  formatUsdcAmount,
  shortAddr,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { useBackupArbiter, useFeeConfig, usePaused, usePrivacySwitches, useVerifier } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button, inputClass } from '@/components/ui'
import { CountryFlag } from '@/components/logos'

const base = { address: ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const

const parseFee = (v: string): bigint | null => {
  const trimmed = v.trim()
  if (!trimmed) return null
  try {
    return parseUnitsExact(trimmed, 6)
  } catch {
    return null
  }
}

function Panel({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-4 sm:p-5">
      <h3 className="display text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>{body}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function ControlsTab({ isOwner }: { isOwner: boolean }) {
  const paused = usePaused()
  const backupArbiter = useBackupArbiter()
  const verifier = useVerifier()
  const feeConfig = useFeeConfig()
  const privacy = usePrivacySwitches()
  const { run, writeContractAsync, pendingKey } = useTx()

  const [newArbiter, setNewArbiter] = useState('')
  const [newBackup, setNewBackup] = useState('')
  const [feeInput, setFeeInput] = useState('')
  const [newFeeRecipient, setNewFeeRecipient] = useState('')
  const [newVerifier, setNewVerifier] = useState('')

  const valid = isAddress(newArbiter.trim()) && newArbiter.trim() !== zeroAddress
  const validBackup = isAddress(newBackup.trim()) && newBackup.trim() !== zeroAddress
  const parsedFee = parseFee(feeInput)
  const validFee = parsedFee !== null && parsedFee <= MAX_LISTING_FEE
  const validRecipient = isAddress(newFeeRecipient.trim()) && newFeeRecipient.trim() !== zeroAddress
  const validVerifier = isAddress(newVerifier.trim())

  const supported = useReadContracts({
    contracts: COUNTRIES.map((c) => ({ ...base, functionName: 'supportedCurrency' as const, args: [currencyToHex(c.currency)] as const })),
    query: { enabled: !!ESCROW_ADDRESS, refetchInterval: 20_000 },
  })

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <Panel
          title="Accrued listing fees"
          body={`Current listing fee: ${formatUsdcAmount(feeConfig.listingFee)} USDC per ad · Recipient: ${feeConfig.feeRecipient ? shortAddr(feeConfig.feeRecipient) : '...'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="display text-2xl font-bold tabular-nums">{formatUsdcAmount(feeConfig.feesAccrued)} USDC</p>
            <Button
              disabled={feeConfig.feesAccrued === 0n}
              loading={pendingKey === 'collect-fees'}
              onClick={() =>
                void run('collect-fees', 'Collect accrued fees', () =>
                  writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'collectFees' }),
                )
              }
            >
              <Coins className="size-4" /> Collect fees
            </Button>
          </div>
        </Panel>
        <div className="glass rounded-3xl p-6 text-sm" style={{ color: 'var(--muted)' }}>
          Governance controls are limited to the contract owner. Your wallet can take cases, rule on disputes, and manage account restrictions.
        </div>
      </div>
    )
  }

  const send = (key: string, label: string, fn: 'pause' | 'unpause') =>
    run(key, label, () => writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: fn }))

  const hasVerifier = verifier && verifier !== zeroAddress

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title={paused ? 'Marketplace is paused' : 'Marketplace is live'}
        body="Pausing stops new ads and new orders. Existing orders, releases, disputes, cancels and withdrawals keep working."
      >
        <Button variant={paused ? 'buy' : 'danger'} loading={pendingKey === 'pause'} onClick={() => void send('pause', paused ? 'Resume marketplace' : 'Pause marketplace', paused ? 'unpause' : 'pause')}>
          {paused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
          {paused ? 'Resume marketplace' : 'Pause marketplace'}
        </Button>
      </Panel>

      <Panel
        title="Platform listing fee & revenue"
        body={`Charged once when an ad is created (cap 0.50 USDC; refreshes & trades are free). Current: ${formatUsdcAmount(feeConfig.listingFee)} USDC · Recipient: ${feeConfig.feeRecipient ? shortAddr(feeConfig.feeRecipient) : '...'}`}
      >
        <div className="inner mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm">
          <div>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Accrued fees ready to collect</p>
            <p className="mono text-base font-bold tabular-nums">{formatUsdcAmount(feeConfig.feesAccrued)} USDC</p>
          </div>
          <Button
            disabled={feeConfig.feesAccrued === 0n}
            loading={pendingKey === 'collect-fees'}
            onClick={() =>
              void run('collect-fees', 'Collect accrued fees', () =>
                writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'collectFees' }),
              )
            }
          >
            <Coins className="size-4" /> Collect fees
          </Button>
        </div>

        <div className="space-y-2.5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              inputMode="decimal"
              value={feeInput}
              onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setFeeInput(e.target.value)}
              placeholder="New fee in USDC (0.00 – 0.50)"
              className={`${inputClass} mono flex-1 text-sm`}
              aria-label="New listing fee in USDC"
            />
            <Button
              disabled={!validFee}
              loading={pendingKey === 'set-fee'}
              onClick={() =>
                void run('set-fee', 'Update listing fee', () =>
                  writeContractAsync({
                    ...base,
                    address: ESCROW_ADDRESS!,
                    functionName: 'setListingFee',
                    args: [parsedFee!],
                  }),
                ).then((ok) => ok && setFeeInput(''))
              }
            >
              Set fee
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={newFeeRecipient}
              onChange={(e) => setNewFeeRecipient(e.target.value)}
              placeholder="Fee recipient address (0x...)"
              spellCheck={false}
              className={`${inputClass} mono flex-1 text-sm`}
              aria-label="Fee recipient address"
            />
            <Button
              disabled={!validRecipient}
              loading={pendingKey === 'set-fee-recipient'}
              onClick={() =>
                void run('set-fee-recipient', 'Update fee recipient', () =>
                  writeContractAsync({
                    ...base,
                    address: ESCROW_ADDRESS!,
                    functionName: 'setFeeRecipient',
                    args: [newFeeRecipient.trim() as Address],
                  }),
                ).then((ok) => ok && setNewFeeRecipient(''))
              }
            >
              Set recipient
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="KYC verifier & enforcement"
        body={`The verifier key can only record or revoke KYC status and can never move funds. Current verifier: ${hasVerifier ? shortAddr(verifier) : 'Not set'}`}
      >
        <div className="inner mb-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm">
          <div>
            <p className="font-semibold">Require KYC for new ads &amp; orders</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Both maker &amp; taker must hold non-expired KYC (exits never blocked)</p>
          </div>
          <Button
            variant={privacy.kycRequired ? 'danger' : 'ghost'}
            disabled={privacy.isLoading}
            loading={pendingKey === 'kyc-switch'}
            onClick={() =>
              void run('kyc-switch', `${privacy.kycRequired ? 'Disable' : 'Enable'} KYC requirement`, () =>
                writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setKycRequired', args: [!privacy.kycRequired] }),
              )
            }
          >
            <UserCheck className="size-4" />
            {privacy.kycRequired ? 'Turn Off' : 'Off (Enable)'}
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newVerifier}
            onChange={(e) => setNewVerifier(e.target.value)}
            placeholder="Verifier server wallet (0x...)"
            spellCheck={false}
            className={`${inputClass} mono flex-1 text-sm`}
            aria-label="Verifier address"
          />
          <Button
            disabled={!validVerifier}
            loading={pendingKey === 'set-verifier'}
            onClick={() =>
              void run('set-verifier', 'Set KYC verifier', () =>
                writeContractAsync({
                  ...base,
                  address: ESCROW_ADDRESS!,
                  functionName: 'setVerifier',
                  args: [newVerifier.trim() as Address],
                }),
              ).then((ok) => ok && setNewVerifier(''))
            }
          >
            Set verifier
          </Button>
        </div>
      </Panel>

      <Panel
        title="Phase 2 privacy switches"
        body="Keep both switches Off until the Phase 2 vault and browser encryption flow are deployed and tested end to end."
      >
        <div className="space-y-2">
          <div className="inner flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm">
            <div>
              <p className="font-semibold">Sealed payment details (modes 1 &amp; 2)</p>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Enables 10m handshake &amp; autoReveal vault details</p>
            </div>
            <Button
              variant={privacy.sealedEnabled ? 'danger' : 'ghost'}
              disabled={privacy.isLoading}
              loading={pendingKey === 'sealed-switch'}
              onClick={() =>
                void run('sealed-switch', `${privacy.sealedEnabled ? 'Disable' : 'Enable'} sealed details`, () =>
                  writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setSealedEnabled', args: [!privacy.sealedEnabled] }),
                )
              }
            >
              <Lock className="size-4" />
              {privacy.sealedEnabled ? 'Turn Off' : 'Off (Enable)'}
            </Button>
          </div>
          <div className="inner flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm">
            <div>
              <p className="font-semibold">Require payer proof on all payments</p>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Late marks always require a transfer ID hash even when Off</p>
            </div>
            <Button
              variant={privacy.payerProofRequired ? 'danger' : 'ghost'}
              disabled={privacy.isLoading}
              loading={pendingKey === 'payer-proof-switch'}
              onClick={() =>
                void run('payer-proof-switch', `${privacy.payerProofRequired ? 'Disable' : 'Enable'} payer proof`, () =>
                  writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setPayerProofRequired', args: [!privacy.payerProofRequired] }),
                )
              }
            >
              <Lock className="size-4" />
              {privacy.payerProofRequired ? 'Turn Off' : 'Off (Enable)'}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Dispute arbiter" body="Replace the primary wallet that rules on disputes. It takes over any dispute that is still open, so only use an address you trust.">
        <input
          value={newArbiter}
          onChange={(e) => setNewArbiter(e.target.value)}
          placeholder="New arbiter address (0x...)"
          spellCheck={false}
          className={`${inputClass} mono text-sm`}
          aria-label="New arbiter address"
        />
        <Button
          className="mt-3"
          disabled={!valid}
          loading={pendingKey === 'arbiter'}
          onClick={() =>
            void run('arbiter', 'Change arbiter', () =>
              writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setArbiter', args: [newArbiter.trim() as Address] }),
            )
          }
        >
          <UserCog className="size-4" /> Set arbiter
        </Button>
      </Panel>

      <Panel
        title="Backup arbiter (7-day fallback)"
        body={`May take or rule on a case once 7 days have passed since dispute (or paidAt if not yet disputed). Current: ${backupArbiter ? shortAddr(backupArbiter) : '...'}`}
      >
        <input
          value={newBackup}
          onChange={(e) => setNewBackup(e.target.value)}
          placeholder="Backup arbiter address (0x...)"
          spellCheck={false}
          className={`${inputClass} mono text-sm`}
          aria-label="Backup arbiter address"
        />
        <Button
          className="mt-3"
          disabled={!validBackup}
          loading={pendingKey === 'backup-arbiter'}
          onClick={() =>
            void run('backup-arbiter', 'Set backup arbiter', () =>
              writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setBackupArbiter', args: [newBackup.trim() as Address] }),
            )
          }
        >
          <ShieldCheck className="size-4" /> Set backup arbiter
        </Button>
      </Panel>

      <div className="lg:col-span-2">
        <Panel title="Supported currencies" body="Switch a local currency off to stop new ads in it. Existing orders are not affected.">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COUNTRIES.map((c, i) => {
              const on = supported.data?.[i]?.status === 'success' ? supported.data[i].result === true : undefined
              const key = `cur-${c.currency}`
              return (
                <li key={c.code}>
                  <button
                    disabled={on === undefined || pendingKey === key}
                    onClick={() =>
                      void run(key, `${on ? 'Disable' : 'Enable'} ${c.currency}`, () =>
                        writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setCurrency', args: [currencyToHex(c.currency), !on] }),
                      )
                    }
                    aria-pressed={on}
                    className="inner flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold disabled:opacity-50"
                  >
                    <CountryFlag code={c.code} size={22} />
                    <span className="flex-1">{c.currency}</span>
                    <span className="text-xs" style={{ color: on ? 'var(--success)' : 'var(--subtle)' }}>{on === undefined ? '...' : on ? 'On' : 'Off'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
