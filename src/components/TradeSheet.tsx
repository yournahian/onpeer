import { useMemo, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import {
  CHAIN_ID,
  DETAILS_MAX_BYTES,
  ESCROW_ADDRESS,
  MAX_OPEN_ORDERS,
  NEW_TAKER_MAX,
  SIDE_SELL,
  countryByCurrency,
  fiatFor,
  formatPrice,
  formatUsdcAmount,
  hexToCurrency,
  maskToMethods,
  shortAddr,
  usdcFor,
} from '@/lib/p2p'
import { formatUnitsFixed, parseUnitsExact } from '@/onchain-money'
import {
  useOpenOrderCount,
  useUsdcAllowance,
  useUsdcBalance,
  type AdWithId,
} from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { MethodLabel } from '@/components/logos'
import { useEligibility } from '@/hooks/useEligibility'
import { Button, Field, Sheet, inputClass } from '@/components/ui'

const safeParse = (v: string, d: number): bigint => {
  try {
    return v ? parseUnitsExact(v, d) : 0n
  } catch {
    return 0n
  }
}

export function TradeSheet({
  ad,
  onClose,
  onOpened,
  initialUsdc,
}: {
  ad: AdWithId | null
  initialUsdc?: string
  onClose: () => void
  onOpened: (orderId: bigint) => void
}) {
  return (
    <Sheet open={!!ad} onClose={onClose} title={ad ? (ad.side === SIDE_SELL ? 'Buy USDC' : 'Sell USDC') : ''}>
      {ad && <TradeForm key={ad.id.toString()} ad={ad} onOpened={onOpened} initialUsdc={initialUsdc} />}
    </Sheet>
  )
}

function TradeForm({
  ad,
  onOpened,
  initialUsdc,
}: {
  ad: AdWithId
  onOpened: (id: bigint) => void
  initialUsdc?: string
}) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { run, approveUsdc, writeContractAsync, pendingKey, busy } = useTx()
  const balance = useUsdcBalance()
  const allowance = useUsdcAllowance()
  const openCount = useOpenOrderCount()
  const { blocked, account } = useEligibility()

  const currency = hexToCurrency(ad.currency)
  const country = countryByCurrency(currency)
  const userBuys = ad.side === SIDE_SELL

  const [fiat, setFiat] = useState('')
  const validInitial = initialUsdc && /^\d+(\.\d{1,6})?$/.test(initialUsdc) ? initialUsdc : ''
  const [usdc, setUsdc] = useState(validInitial)
  const [edited, setEdited] = useState<'fiat' | 'usdc'>(validInitial ? 'usdc' : 'fiat')
  const [details, setDetails] = useState('')

  const usdcRaw = useMemo(
    () => (edited === 'fiat' ? usdcFor(safeParse(fiat, 6), ad.priceE6) : safeParse(usdc, 6)),
    [edited, fiat, usdc, ad.priceE6],
  )
  const fiatRaw = useMemo(
    () => (edited === 'fiat' ? safeParse(fiat, 6) : fiatFor(safeParse(usdc, 6), ad.priceE6)),
    [edited, fiat, usdc, ad.priceE6],
  )

  const shownFiat = edited === 'fiat' ? fiat : fiatRaw > 0n ? formatUnitsFixed(fiatRaw, 6, 2) : ''
  const shownUsdc = edited === 'usdc' ? usdc : usdcRaw > 0n ? formatUnitsFixed(usdcRaw, 6, 4) : ''

  const detailBytes = new TextEncoder().encode(details).length
  const isRemainder = usdcRaw === ad.available

  let problem: string | null = null
  if (usdcRaw === 0n) problem = null
  else if (usdcRaw > ad.available) problem = `Only ${formatUsdcAmount(ad.available)} USDC is available.`
  else if (usdcRaw > ad.maxAmount) problem = `Maximum is ${formatUsdcAmount(ad.maxAmount)} USDC.`
  else if (usdcRaw < ad.minAmount && !isRemainder) problem = `Minimum is ${formatUsdcAmount(ad.minAmount)} USDC.`
  else if (!userBuys && balance !== undefined && usdcRaw > balance)
    problem = `You have ${formatUsdcAmount(balance)} USDC.`
  else if (!userBuys && detailBytes > DETAILS_MAX_BYTES) problem = 'Payment details are too long.'
  else if (openCount >= MAX_OPEN_ORDERS)
    problem = `You already have ${MAX_OPEN_ORDERS} open orders. Finish one first.`
  else if (account && account.ordersCompleted < ad.minTakerCompleted)
    problem = `This advertiser requires ${ad.minTakerCompleted}+ completed trades. You have ${account.ordersCompleted}.`
  else if (account && account.ordersCompleted === 0 && usdcRaw > NEW_TAKER_MAX)
    problem = `New accounts are limited to ${formatUsdcAmount(NEW_TAKER_MAX, 0)} USDC per order until their first completed trade.`
  if (!problem && blocked) problem = blocked

  const ready =
    usdcRaw > 0n && !problem && (userBuys || (details.trim().length > 0 && detailBytes <= DETAILS_MAX_BYTES))

  const submit = async () => {
    const escrow = ESCROW_ADDRESS
    if (!ready || !escrow || !address) return
    if (!userBuys && (allowance ?? 0n) < usdcRaw) {
      const ok = await approveUsdc(usdcRaw)
      if (!ok) return
    }
    const ok = await run('open', 'Open order', () =>
      writeContractAsync({
        address: escrow,
        abi: p2pEscrowAbi,
        functionName: 'openOrder',
        args: [ad.id, usdcRaw, ad.priceE6, userBuys ? '' : details.trim()],
        chainId: CHAIN_ID,
      }),
    )
    if (!ok || !publicClient) return
    const ids = await publicClient.readContract({
      address: escrow,
      abi: p2pEscrowAbi,
      functionName: 'getUserOrderIds',
      args: [address],
    })
    const last = ids[ids.length - 1]
    if (last !== undefined) onOpened(last)
  }

  const cta = !isConnected ? null : (
    <Button
      variant={userBuys ? 'buy' : 'sell'}
      className="mt-5 w-full"
      disabled={!ready}
      loading={busy}
      onClick={() => void submit()}
    >
      {pendingKey === 'approve'
        ? 'Approve USDC in wallet...'
        : busy
          ? 'Confirm in wallet...'
          : userBuys
            ? 'Buy USDC'
            : 'Lock USDC and sell'}
    </Button>
  )

  return (
    <div>
      <div className="inner rounded-2xl p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
            Price
          </span>
          <span className="display text-xl font-bold tabular-nums">
            {formatPrice(ad.priceE6)} {currency}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
          <span className="mono">{shortAddr(ad.maker)}</span>
          <span>Pay within {ad.windowMinutes} min</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {maskToMethods(ad.paymentMask).map((m) => (
            <span
              key={m.bit}
              className="rounded-md px-2 py-1 text-xs font-medium"
              style={{ background: 'var(--fill-3)', color: 'var(--accent-hover)' }}
            >
              <MethodLabel method={m} />
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Field label={userBuys ? `I will pay (${currency})` : `I will receive (${currency})`}>
          <input
            inputMode="decimal"
            value={shownFiat}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              if (/^\d*\.?\d{0,2}$/.test(v)) {
                setEdited('fiat')
                setFiat(v)
              }
            }}
            placeholder={`${country?.symbol ?? ''} 0.00`}
            className={`${inputClass} display text-2xl font-bold`}
          />
        </Field>
        <Field
          label={userBuys ? 'I will receive (USDC)' : 'I will sell (USDC)'}
          hint={
            <>
              Limit {formatUsdcAmount(ad.minAmount)} - {formatUsdcAmount(ad.maxAmount > ad.available ? ad.available : ad.maxAmount)}{' '}
              USDC
              {!userBuys && balance !== undefined && ` · Balance ${formatUsdcAmount(balance)}`}
            </>
          }
        >
          <input
            inputMode="decimal"
            value={shownUsdc}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              if (/^\d*\.?\d{0,6}$/.test(v)) {
                setEdited('usdc')
                setUsdc(v)
              }
            }}
            placeholder="0.00"
            className={`${inputClass} display text-2xl font-bold`}
          />
        </Field>

        {!userBuys && (
          <Field
            label="Where should the buyer send your fiat?"
            hint={`UPI ID, wallet number or account details (${detailBytes}/${DETAILS_MAX_BYTES} bytes). Stored onchain and visible to everyone: use a receive-only ID in your own name.`}
          >
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="e.g. name@upi, or bKash 01XXXXXXXXX (personal)"
              className={`${inputClass} resize-none text-sm`}
            />
          </Field>
        )}
      </div>

      {problem && (
        <p className="mt-3 flex items-start gap-2 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {problem}
        </p>
      )}

      <div className="inner mt-4 rounded-2xl p-3 text-xs" style={{ color: 'var(--subtle)' }}>
        {userBuys
          ? 'The seller\u2019s USDC is already locked in escrow. Pay in fiat, mark the order as paid, and the seller releases it to you.'
          : 'Your USDC is locked in escrow when the order opens. It only moves when you release it, or an arbiter rules on a dispute.'}
      </div>

      {isConnected ? (
        cta
      ) : (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <Button className="mt-5 w-full" onClick={show}>
              Connect wallet
            </Button>
          )}
        </ConnectKitButton.Custom>
      )}
    </div>
  )
}
