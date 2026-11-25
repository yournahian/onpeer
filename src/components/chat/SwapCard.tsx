import { ConnectWalletCustom } from '@/components/TelegramWalletModal'
import { Check, ExternalLink, Info } from 'lucide-react'
import { SLIPPAGE_OPTIONS, useSwapFlow, type SwapToken } from '@/hooks/useSwapFlow'
import { Button, Chip } from '@/components/ui'
import { ChainLogo, CoinLogo } from '@/components/logos'

export function SwapCard({
  tokenIn,
  tokenOut: requestedOut,
  amount,
  onSettled,
}: {
  tokenIn: SwapToken
  tokenOut?: SwapToken
  amount: string
  onSettled: (text: string) => void
}) {
  const flow = useSwapFlow({ tokenIn, tokenOut: requestedOut, amount, onSettled })
  const { phase, estimate, done, error, slippage, tokenOut } = flow

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      <p className="flex flex-wrap items-center gap-1.5 font-semibold">
        <span>Swap {amount}</span>
        <CoinLogo symbol={tokenIn} size={16} />
        <span>{tokenIn} to</span>
        <CoinLogo symbol={tokenOut} size={16} />
        <span>{tokenOut} on</span>
        <ChainLogo chain="Arc_Testnet" size={16} />
        <span>Arc Testnet</span>
      </p>

      {phase === 'quoted' && estimate && (
        <div className="inner space-y-1.5 rounded-xl p-3">
          <Row label="Expected output">
            {estimate.estimatedOutput.amount} {estimate.estimatedOutput.token}
          </Row>
          {(estimate.fees ?? []).map((f, i) => (
            <Row key={i} label={`${f.type} fee`}>
              {f.amount ?? '0'} {f.token}
            </Row>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>
              Max slippage
            </span>
            {SLIPPAGE_OPTIONS.map((bps) => (
              <Chip key={bps} active={slippage === bps} onClick={() => void flow.quote(bps)}>
                {bps / 100}%
              </Chip>
            ))}
          </div>
          <p className="flex items-start gap-1.5 pt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Routed through a swap provider with its own terms. The final amount can differ from the quote within your slippage.
          </p>
        </div>
      )}

      {phase === 'done' && done && (
        <div className="rounded-xl p-3" style={{ background: 'rgba(141,216,159,0.12)' }}>
          <p className="flex items-center gap-2 font-semibold" style={{ color: 'var(--success)' }}>
            <Check className="size-4" />
            {done.status === 'DONE' ? 'Swap complete' : 'Swap submitted'}
            {done.amountOut ? `: received ${done.amountOut} ${tokenOut}` : ''}
          </p>
          {done.explorerUrl && (
            <a
              href={done.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              View on explorer <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {phase === 'done' ? null : !flow.isConnected ? (
        <ConnectWalletCustom>
          {({ show }) => (
            <Button className="w-full" onClick={show}>
              Connect wallet
            </Button>
          )}
        </ConnectWalletCustom>
      ) : phase === 'quoted' ? (
        <Button variant="buy" className="w-full" onClick={() => void flow.execute()}>
          Confirm swap
        </Button>
      ) : phase === 'swapping' ? (
        <Button className="w-full" loading disabled>
          Confirm in your wallet...
        </Button>
      ) : (
        <Button className="w-full" loading={phase === 'quoting'} disabled={phase === 'quoting'} onClick={() => void flow.quote()}>
          {phase === 'error' ? 'Try again' : 'Get quote'}
        </Button>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="capitalize" style={{ color: 'var(--subtle)' }}>
        {label}
      </span>
      <span className="tabular-nums">{children}</span>
    </div>
  )
}
