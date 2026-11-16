import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  COUNTRIES,
  DETAILS_MAX_BYTES,
  MERCHANT_MARGIN,
  MIN_TAKER_OPTIONS,
  ESCROW_ADDRESS,
  SIDE_BUY,
  SIDE_SELL,
  bitsToMask,
  currencyToHex,
  formatUsdcAmount,
  methodsForCountry,
} from '@/lib/p2p'
import { parseUnitsExact } from '@/onchain-money'
import { useUsdcAllowance, useUsdcBalance } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { MethodLabel } from '@/components/logos'
import { useEligibility } from '@/hooks/useEligibility'
import { Button, Chip, Field, Sheet, inputClass } from '@/components/ui'

const safe = (v: string): bigint => {
  try {
    return v ? parseUnitsExact(v, 6) : 0n
  } catch {
    return 0n
  }
}

const decimalInput = (setter: (v: string) => void, places: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
  const v = e.target.value.replace(/[^0-9.]/g, '')
  if (new RegExp(`^\\d*\\.?\\d{0,${places}}$`).test(v)) setter(v)
}

export function PostAdSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Post an ad">
      {open && <PostAdForm onDone={onClose} />}
    </Sheet>
  )
}

function PostAdForm({ onDone }: { onDone: () => void }) {
  const { isConnected } = useAccount()
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()
  const { blocked, account } = useEligibility()

  const [side, setSide] = useState<number>(SIDE_SELL)
  const [countryCode, setCountryCode] = useState('IN')
  const [price, setPrice] = useState('')
  const [total, setTotal] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [bits, setBits] = useState<number[]>([])
  const [windowMin, setWindowMin] = useState(30)
  const [details, setDetails] = useState('')
  const [minTaker, setMinTaker] = useState(0)

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0]
  const methods = methodsForCountry(country.code)
  const priceE6 = safe(price)
  const totalRaw = safe(total)
  const minRaw = safe(min)
  const maxRaw = safe(max)
  const detailBytes = useMemo(() => new TextEncoder().encode(details).length, [details])
  const isSell = side === SIDE_SELL

  let problem: string | null = null
  if (totalRaw > 0n && minRaw > 0n && maxRaw > 0n) {
    if (minRaw > maxRaw) problem = 'Minimum cannot be above the maximum.'
    else if (maxRaw > totalRaw) problem = 'Maximum cannot be above the total amount.'
    else if (isSell && balance !== undefined && totalRaw > balance)
      problem = `You only have ${formatUsdcAmount(balance)} USDC.`
  }
  if (!problem && detailBytes > DETAILS_MAX_BYTES) problem = 'Payment details are too long.'

  const ready =
    priceE6 > 0n &&
    totalRaw > 0n &&
    minRaw > 0n &&
    maxRaw > 0n &&
    bits.length > 0 &&
    !problem &&
    !blocked &&
    (!isSell || details.trim().length > 0)

  const toggle = (bit: number) =>
    setBits((b) => (b.includes(bit) ? b.filter((x) => x !== bit) : [...b, bit]))

  const submit = async () => {
    const escrow = ESCROW_ADDRESS
    if (!ready || !escrow) return
    if (isSell && (allowance ?? 0n) < totalRaw) {
      const ok = await approveUsdc(totalRaw)
      if (!ok) return
    }
    const ok = await run('createAd', 'Post ad', () =>
      writeContractAsync({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'createAd',
        args: [
          side,
          currencyToHex(country.currency),
          priceE6,
          totalRaw,
          minRaw,
          maxRaw,
          bitsToMask(bits),
          windowMin,
          minTaker,
          details.trim(),
        ],
        chainId: CHAIN_ID,
      }),
    )
    if (ok) onDone()
  }

  return (
    <div className="space-y-4">
      <div role="tablist" className="grid grid-cols-2 rounded-xl p-1" style={{ background: 'var(--fill-2)' }}>
        {[
          { v: SIDE_SELL, label: 'I want to sell USDC' },
          { v: SIDE_BUY, label: 'I want to buy USDC' },
        ].map((o) => (
          <button
            key={o.v}
            role="tab"
            aria-selected={side === o.v}
            onClick={() => setSide(o.v)}
            className="min-h-10 rounded-lg text-sm font-bold transition-colors"
            style={{
              background: side === o.v ? 'var(--accent-bg)' : 'transparent',
              color: side === o.v ? 'var(--on-accent)' : 'var(--muted)',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Country">
        {COUNTRIES.map((c) => (
          <Chip
            key={c.code}
            active={c.code === countryCode}
            onClick={() => {
              setCountryCode(c.code)
              setBits([])
            }}
          >
            {c.currency}
          </Chip>
        ))}
      </div>

      <Field label={`Price per 1 USDC (${country.currency})`}>
        <input
          inputMode="decimal"
          value={price}
          onChange={decimalInput(setPrice, 4)}
          placeholder="0.00"
          className={`${inputClass} display text-2xl font-bold`}
        />
      </Field>

      <Field
        label={isSell ? 'USDC to lock in escrow' : 'Maximum USDC you want to buy'}
        hint={isSell && balance !== undefined ? `Balance ${formatUsdcAmount(balance)} USDC` : undefined}
      >
        <input
          inputMode="decimal"
          value={total}
          onChange={decimalInput(setTotal, 6)}
          placeholder="0.00"
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Min order (USDC)">
          <input inputMode="decimal" value={min} onChange={decimalInput(setMin, 6)} placeholder="10" className={inputClass} />
        </Field>
        <Field label="Max order (USDC)">
          <input inputMode="decimal" value={max} onChange={decimalInput(setMax, 6)} placeholder="500" className={inputClass} />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
          Payment methods
        </p>
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <Chip key={m.bit} active={bits.includes(m.bit)} onClick={() => toggle(m.bit)}>
              <MethodLabel method={m} />
            </Chip>
          ))}
        </div>
      </div>

      <Field label="Payment window">
        <div className="flex gap-2">
          {[15, 30, 45, 60].map((m) => (
            <Chip key={m} active={windowMin === m} onClick={() => setWindowMin(m)}>
              {m} min
            </Chip>
          ))}
        </div>
      </Field>

      <Field
        label="Who can trade with you"
        hint="Require a minimum number of completed trades with different counterparties. Protects you from brand-new accounts."
      >
        <div className="flex flex-wrap gap-2">
          {MIN_TAKER_OPTIONS.map((n) => (
            <Chip key={n} active={minTaker === n} onClick={() => setMinTaker(n)}>
              {n === 0 ? 'Anyone' : `${n}+ trades`}
            </Chip>
          ))}
        </div>
      </Field>

      <Field
        label={isSell ? 'Where buyers should send fiat' : 'Note for sellers (optional)'}
        hint={
          isSell
            ? `Shown to buyers and stored onchain, so everyone can read it (${detailBytes}/${DETAILS_MAX_BYTES} bytes). Use a receive-only ID in your own name.`
            : 'Sellers will add their own receiving details when they open an order.'
        }
      >
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          placeholder={isSell ? 'e.g. name@upi' : 'e.g. I pay within 5 minutes'}
          className={`${inputClass} resize-none text-sm`}
        />
      </Field>

      {(problem || blocked) && (
        <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {blocked ?? problem}
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        {account?.merchant
          ? 'Your ad will carry the Merchant badge. It stays fillable only while your security margin stays above 100 USDC.'
          : `Want a Merchant badge? Deposit ${formatUsdcAmount(MERCHANT_MARGIN, 0)} USDC security margin on the Merchant tab before posting.`}
      </p>

      {isConnected ? (
        <Button className="w-full" disabled={!ready} loading={busy} onClick={() => void submit()}>
          {pendingKey === 'approve'
            ? 'Approve USDC in wallet...'
            : busy
              ? 'Confirm in wallet...'
              : isSell
                ? 'Lock USDC and post ad'
                : 'Post ad'}
        </Button>
      ) : (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <Button className="w-full" onClick={show}>
              Connect wallet
            </Button>
          )}
        </ConnectKitButton.Custom>
      )}
    </div>
  )
}
