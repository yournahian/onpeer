import { useState } from 'react'
import { Coins, Loader2, PauseCircle, PlayCircle, ShieldCheck, UserCog } from 'lucide-react'
import { useReadContracts } from 'wagmi'
import { isAddress, zeroAddress, type Address } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  COUNTRIES,
  P2P_ASSETS,
  VISIBLE_P2P_ASSETS,
  currencyToHex,
  formatUsdcAmount,
  getEscrowConfig,
  maxListingFeeFor,
  shortAddr,
  type P2pAsset,
} from '@/lib/p2p'
import { formatUnitsExact, parseUnitsExact } from '@/onchain-money'
import { useBackupArbiter, useFeeConfig, usePaused, usePrivacySwitches, useVerifier } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button, inputClass } from '@/components/ui'
import { CoinLogo, CountryFlag } from '@/components/logos'

const isValidDecimalInput = (v: string, maxDecimals: number): boolean => {
  if (!/^\d*\.?\d*$/.test(v)) return false
  const dot = v.indexOf('.')
  return dot === -1 || v.length - dot - 1 <= maxDecimals
}

const parseFee = (v: string, decimals: number): bigint | null => {
  const trimmed = v.trim()
  if (!trimmed) return null
  try {
    return parseUnitsExact(trimmed, decimals)
  } catch {
    return null
  }
}

function Panel({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="glass overflow-hidden rounded-3xl p-4 sm:p-5">
      <h3 className="display text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>{body}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function OnchainSwitchRow({
  title,
  description,
  enabled,
  loading,
  disabled,
  onToggle,
}: {
  title: string
  description: string
  enabled: boolean
  loading: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div
      className="inner flex items-center justify-between gap-4 rounded-xl px-3.5 py-3 text-sm"
      style={enabled ? { borderColor: 'rgba(126, 241, 179, 0.28)' } : undefined}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{title}</p>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={
              enabled
                ? {
                    background: 'rgba(126, 241, 179, 0.14)',
                    color: 'var(--success)',
                    border: '1px solid rgba(126, 241, 179, 0.32)',
                  }
                : {
                    background: 'var(--fill-2)',
                    color: 'var(--subtle)',
                    border: '1px solid var(--border)',
                  }
            }
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: enabled ? 'var(--success)' : 'var(--subtle)' }}
            />
            {enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${title}: currently ${enabled ? 'on' : 'off'}`}
        disabled={disabled || loading}
        onClick={onToggle}
        className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
        style={
          enabled
            ? { background: 'var(--success)', borderColor: 'var(--success)' }
            : { background: 'var(--fill-3)', borderColor: 'var(--border)' }
        }
      >
        <span
          className={`inline-flex size-5 items-center justify-center rounded-full shadow-sm transition-transform duration-200 ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
          style={{ background: enabled ? '#061a10' : 'var(--ink)' }}
        >
          {loading && <Loader2 className="size-3 animate-spin" style={{ color: enabled ? '#7ef1b3' : 'var(--bg)' }} />}
        </span>
      </button>
    </div>
  )
}

export function ControlsTab({ isOwner }: { isOwner: boolean }) {
  const [selectedAsset, setSelectedAsset] = useState<P2pAsset>('USDC')
  const [applyAllAssets, setApplyAllAssets] = useState(false)
  const selectedCfg = getEscrowConfig(selectedAsset)
  const escrowAddress = selectedCfg.escrowAddress
  const tokenDecimals = selectedCfg.decimals
  const maxFee = maxListingFeeFor(selectedAsset)
  const maxFeeDisplay = formatUnitsExact(maxFee, tokenDecimals)

  const paused = usePaused(selectedAsset)
  const backupArbiter = useBackupArbiter(selectedAsset)
  const verifier = useVerifier(selectedAsset)
  const feeConfig = useFeeConfig(selectedAsset)
  const privacy = usePrivacySwitches(selectedAsset)
  const { run, writeContractAsync, pendingKey } = useTx(selectedAsset)

  const [newArbiter, setNewArbiter] = useState('')
  const [newBackup, setNewBackup] = useState('')
  const [feeInput, setFeeInput] = useState('')
  const [newFeeRecipient, setNewFeeRecipient] = useState('')
  const [newVerifier, setNewVerifier] = useState('')

  const valid = isAddress(newArbiter.trim()) && newArbiter.trim() !== zeroAddress
  const validBackup = isAddress(newBackup.trim()) && newBackup.trim() !== zeroAddress
  const parsedFee = parseFee(feeInput, tokenDecimals)
  const validFee = parsedFee !== null && parsedFee <= maxFee
  const validRecipient = isAddress(newFeeRecipient.trim()) && newFeeRecipient.trim() !== zeroAddress
  const validVerifier = isAddress(newVerifier.trim())

  const supported = useReadContracts({
    contracts: COUNTRIES.map((c) => ({
      address: escrowAddress,
      abi: p2pEscrowAbi,
      chainId: CHAIN_ID,
      functionName: 'supportedCurrency' as const,
      args: [currencyToHex(c.currency)] as const,
    })),
    query: { enabled: !!escrowAddress, refetchInterval: 20_000 },
  })

  const targetAddresses = applyAllAssets
    ? P2P_ASSETS.map((a) => getEscrowConfig(a).escrowAddress)
    : [escrowAddress]

  const execAcrossTargets = (
    key: string,
    label: string,
    callFor: (addr: Address) => Promise<`0x${string}`>,
  ) =>
    run(key, applyAllAssets ? `${label} (all 4 markets)` : `${label} (${selectedAsset})`, async () => {
      let lastHash: `0x${string}` = '0x0'
      for (const addr of targetAddresses) {
        lastHash = await callFor(addr)
      }
      return lastHash
    })

  const marketSelectorBar = (
    <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {VISIBLE_P2P_ASSETS.map((a) => {
          const active = selectedAsset === a
          return (
            <button
              key={a}
              type="button"
              onClick={() => {
                setSelectedAsset(a)
                setFeeInput('')
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                background: active ? 'var(--accent-bg)' : 'var(--fill-2)',
                color: active ? 'var(--on-accent)' : 'var(--muted)',
              }}
            >
              <CoinLogo symbol={a} size={14} />
              <span>{a} Escrow</span>
            </button>
          )
        })}
      </div>
      {isOwner && (
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          <input
            type="checkbox"
            checked={applyAllAssets}
            onChange={(e) => setApplyAllAssets(e.target.checked)}
            className="size-4"
          />
          <span>Sync global governance switches across all 4 asset contracts</span>
        </label>
      )}
    </div>
  )

  if (!isOwner) {
    return (
      <div className="space-y-4">
        {marketSelectorBar}
        <Panel
          title={`Accrued listing fees (${selectedAsset})`}
          body={`Current listing fee: ${formatUsdcAmount(feeConfig.listingFee, undefined, selectedAsset)} ${selectedAsset} per ad · Recipient: ${feeConfig.feeRecipient ? shortAddr(feeConfig.feeRecipient) : '...'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="display text-2xl font-bold tabular-nums">
              {formatUsdcAmount(feeConfig.feesAccrued, undefined, selectedAsset)} {selectedAsset}
            </p>
            <Button
              disabled={feeConfig.feesAccrued === 0n}
              loading={pendingKey === 'collect-fees'}
              onClick={() =>
                void run('collect-fees', `Collect ${selectedAsset} accrued fees`, () =>
                  writeContractAsync({
                    address: escrowAddress,
                    abi: p2pEscrowAbi,
                    chainId: CHAIN_ID,
                    functionName: 'collectFees',
                  }),
                )
              }
            >
              <Coins className="size-4" /> Collect {selectedAsset} fees
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
    execAcrossTargets(key, label, (addr) =>
      writeContractAsync({ address: addr, abi: p2pEscrowAbi, chainId: CHAIN_ID, functionName: fn }),
    )

  const hasVerifier = verifier && verifier !== zeroAddress

  return (
    <div className="space-y-4">
      {marketSelectorBar}
      <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title={paused ? `${selectedAsset} marketplace is paused` : `${selectedAsset} marketplace is live`}
        body="Pausing stops new ads and new orders. Existing orders, releases, disputes, cancels and withdrawals keep working."
      >
        <Button variant={paused ? 'buy' : 'danger'} loading={pendingKey === 'pause'} onClick={() => void send('pause', paused ? 'Resume marketplace' : 'Pause marketplace', paused ? 'unpause' : 'pause')}>
          {paused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
          {paused ? 'Resume marketplace' : 'Pause marketplace'}
        </Button>
      </Panel>

      <Panel
        title={`Platform listing fee & revenue (${selectedAsset})`}
        body={`Charged once when an ad is created (cap ${maxFeeDisplay} ${selectedAsset}; refreshes & trades are free). Current: ${formatUsdcAmount(feeConfig.listingFee, undefined, selectedAsset)} ${selectedAsset} · Recipient: ${feeConfig.feeRecipient ? shortAddr(feeConfig.feeRecipient) : '...'}`}
      >
        <div className="inner mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm">
          <div>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Accrued fees ready to collect</p>
            <p className="mono text-base font-bold tabular-nums">
              {formatUsdcAmount(feeConfig.feesAccrued, undefined, selectedAsset)} {selectedAsset}
            </p>
          </div>
          <Button
            disabled={feeConfig.feesAccrued === 0n}
            loading={pendingKey === 'collect-fees'}
            onClick={() =>
              void run('collect-fees', `Collect ${selectedAsset} accrued fees`, () =>
                writeContractAsync({
                  address: escrowAddress,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'collectFees',
                }),
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
              onChange={(e) => isValidDecimalInput(e.target.value, tokenDecimals) && setFeeInput(e.target.value)}
              placeholder={`New fee in ${selectedAsset} (0 – ${maxFeeDisplay})`}
              className={`${inputClass} mono flex-1 text-sm`}
              aria-label={`New listing fee in ${selectedAsset}`}
            />
            <Button
              disabled={!validFee}
              loading={pendingKey === 'set-fee'}
              onClick={() =>
                void run('set-fee', `Update ${selectedAsset} listing fee`, () =>
                  writeContractAsync({
                    address: escrowAddress,
                    abi: p2pEscrowAbi,
                    chainId: CHAIN_ID,
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
                void execAcrossTargets('set-fee-recipient', 'Update fee recipient', (addr) =>
                  writeContractAsync({
                    address: addr,
                    abi: p2pEscrowAbi,
                    chainId: CHAIN_ID,
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
        body={`The verifier key can only record or revoke KYC status and can never move funds. Current verifier (${selectedAsset}): ${hasVerifier ? shortAddr(verifier) : 'Not set'}`}
      >
        <div className="mb-3">
          <OnchainSwitchRow
            title="Require KYC for new ads & orders"
            description="Both maker & taker must hold non-expired KYC (exits never blocked)"
            enabled={privacy.kycRequired}
            loading={pendingKey === 'kyc-switch'}
            disabled={privacy.isLoading}
            onToggle={() =>
              void execAcrossTargets('kyc-switch', `${privacy.kycRequired ? 'Disable' : 'Enable'} KYC requirement`, (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setKycRequired',
                  args: [!privacy.kycRequired],
                }),
              )
            }
          />
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
              void execAcrossTargets('set-verifier', 'Set KYC verifier', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
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
        title="Privacy & proof switches"
        body="Phase 2 encrypted vault and order chat are live on the Cloudflare Worker. Toggle these onchain switches to enforce sealed payment details or mandatory transfer proofs."
      >
        <div className="space-y-2.5">
          <OnchainSwitchRow
            title="Sealed payment details (Mode 2 vault)"
            description="Encrypts payment details in the vault and auto-reveals only to the order counterparty"
            enabled={privacy.sealedEnabled}
            loading={pendingKey === 'sealed-switch'}
            disabled={privacy.isLoading}
            onToggle={() =>
              void execAcrossTargets('sealed-switch', `${privacy.sealedEnabled ? 'Disable' : 'Enable'} sealed details`, (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setSealedEnabled',
                  args: [!privacy.sealedEnabled],
                }),
              )
            }
          />
          <OnchainSwitchRow
            title="Require payer proof on all payments"
            description="Late marks always require a transfer ID hash even when Off"
            enabled={privacy.payerProofRequired}
            loading={pendingKey === 'payer-proof-switch'}
            disabled={privacy.isLoading}
            onToggle={() =>
              void execAcrossTargets('payer-proof-switch', `${privacy.payerProofRequired ? 'Disable' : 'Enable'} payer proof`, (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setPayerProofRequired',
                  args: [!privacy.payerProofRequired],
                }),
              )
            }
          />
        </div>
      </Panel>

      <Panel title="Dispute arbiter (multi-arbiter)" body="Replace the main arbiter wallet, or add/remove multiple additional primary arbiters (v2.3). Any primary arbiter can review & rule disputes immediately (except their own orders).">
        <input
          value={newArbiter}
          onChange={(e) => setNewArbiter(e.target.value)}
          placeholder="Arbiter wallet address (0x...)"
          spellCheck={false}
          className={`${inputClass} mono text-sm`}
          aria-label="Arbiter wallet address"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={!valid}
            loading={pendingKey === 'add-extra-arbiter'}
            onClick={() =>
              void execAcrossTargets('add-extra-arbiter', 'Add extra arbiter', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setExtraArbiter',
                  args: [newArbiter.trim() as Address, 1],
                }),
              ).then((ok) => ok && setNewArbiter(''))
            }
          >
            <UserCog className="size-4" /> Add extra arbiter
          </Button>
          <Button
            variant="danger"
            disabled={!valid}
            loading={pendingKey === 'remove-extra-arbiter'}
            onClick={() =>
              void execAcrossTargets('remove-extra-arbiter', 'Remove extra arbiter', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setExtraArbiter',
                  args: [newArbiter.trim() as Address, 0],
                }),
              ).then((ok) => ok && setNewArbiter(''))
            }
          >
            Remove
          </Button>
          <Button
            variant="ghost"
            disabled={!valid}
            loading={pendingKey === 'arbiter'}
            onClick={() =>
              void execAcrossTargets('arbiter', 'Replace main arbiter', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setArbiter',
                  args: [newArbiter.trim() as Address],
                }),
              )
            }
          >
            Replace main
          </Button>
        </div>
      </Panel>

      <Panel
        title="Backup arbiter (7-day fallback, multi)"
        body={`May take or rule on a case once 7 days have passed since dispute. Replace the main backup or add/remove multiple extra backup arbiters (v2.3). Main (${selectedAsset}): ${backupArbiter ? shortAddr(backupArbiter) : '...'}`}
      >
        <input
          value={newBackup}
          onChange={(e) => setNewBackup(e.target.value)}
          placeholder="Backup arbiter address (0x...)"
          spellCheck={false}
          className={`${inputClass} mono text-sm`}
          aria-label="Backup arbiter address"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={!validBackup}
            loading={pendingKey === 'add-extra-backup'}
            onClick={() =>
              void execAcrossTargets('add-extra-backup', 'Add extra backup arbiter', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setExtraArbiter',
                  args: [newBackup.trim() as Address, 2],
                }),
              ).then((ok) => ok && setNewBackup(''))
            }
          >
            <ShieldCheck className="size-4" /> Add extra backup
          </Button>
          <Button
            variant="danger"
            disabled={!validBackup}
            loading={pendingKey === 'remove-extra-backup'}
            onClick={() =>
              void execAcrossTargets('remove-extra-backup', 'Remove extra backup arbiter', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setExtraArbiter',
                  args: [newBackup.trim() as Address, 0],
                }),
              ).then((ok) => ok && setNewBackup(''))
            }
          >
            Remove
          </Button>
          <Button
            variant="ghost"
            disabled={!validBackup}
            loading={pendingKey === 'backup-arbiter'}
            onClick={() =>
              void execAcrossTargets('backup-arbiter', 'Replace main backup arbiter', (addr) =>
                writeContractAsync({
                  address: addr,
                  abi: p2pEscrowAbi,
                  chainId: CHAIN_ID,
                  functionName: 'setBackupArbiter',
                  args: [newBackup.trim() as Address],
                }),
              )
            }
          >
            Replace main
          </Button>
        </div>
      </Panel>

      <div className="lg:col-span-2">
        <Panel title={`Supported currencies (${selectedAsset})`} body="Switch a local currency off to stop new ads in it. Existing orders are not affected.">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COUNTRIES.map((c, i) => {
              const on = supported.data?.[i]?.status === 'success' ? supported.data[i].result === true : undefined
              const key = `cur-${c.currency}`
              return (
                <li key={c.code}>
                  <button
                    disabled={on === undefined || pendingKey === key}
                    onClick={() =>
                      void execAcrossTargets(key, `${on ? 'Disable' : 'Enable'} ${c.currency}`, (addr) =>
                        writeContractAsync({
                          address: addr,
                          abi: p2pEscrowAbi,
                          chainId: CHAIN_ID,
                          functionName: 'setCurrency',
                          args: [currencyToHex(c.currency), !on],
                        }),
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
    </div>
  )
}
