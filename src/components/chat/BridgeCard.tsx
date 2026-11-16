import { ConnectKitButton } from 'connectkit'
import { Check, ExternalLink, Info, Loader2, X } from 'lucide-react'
import {
  STEP_LABELS,
  STEP_ORDER,
  chainLabel,
  useBridgeFlow,
  type BridgeChainName,
  type StepState,
} from '@/hooks/useBridgeFlow'
import { Button } from '@/components/ui'

export function BridgeCard({
  from,
  to,
  amount,
  onSettled,
}: {
  from: BridgeChainName
  to: BridgeChainName
  amount: string
  onSettled: (text: string) => void
}) {
  const flow = useBridgeFlow({ from, to, amount, onSettled })
  const { phase, quote, steps, result, error } = flow
  const showSteps = phase === 'bridging' || phase === 'done' || phase === 'failed'

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      <p className="font-semibold">
        Bridge {amount} USDC from {chainLabel(from)} to {chainLabel(to)}
      </p>

      {phase === 'quoted' && quote && (
        <div className="inner space-y-1.5 rounded-xl p-3">
          <Row label="Recipient">You, on {chainLabel(to)}</Row>
          {quote.fees.map((f, i) => (
            <Row key={i} label={`${f.type} fee`}>
              {f.amount ?? '0'} {f.token}
            </Row>
          ))}
          {quote.gas.map((g, i) => (
            <Row key={`g${i}`} label={`Gas: ${g.name}`}>
              {g.fee} {g.token}
            </Row>
          ))}
          <p className="flex items-start gap-1.5 pt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Circle delivers the USDC on the destination, so you only need gas on {chainLabel(from)}.
          </p>
        </div>
      )}

      {showSteps && (
        <div className="inner space-y-2 rounded-xl p-3">
          {STEP_ORDER.map((name) => {
            const state: StepState = steps[name] ?? 'idle'
            const real = result?.steps.find((s) => s.name === name)
            return (
              <div key={name} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <StepIcon state={state} />
                  {STEP_LABELS[name]}
                </span>
                {real?.explorerUrl && (
                  <a
                    href={real.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold"
                    style={{ color: 'var(--accent)' }}
                  >
                    View <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}

      {phase === 'done' && (
        <p className="font-semibold" style={{ color: 'var(--success)' }}>
          Bridge complete. Your USDC is on {chainLabel(to)}.
        </p>
      )}
      {phase === 'failed' && (
        <p style={{ color: 'var(--danger)' }}>
          The transfer stopped part-way. Your funds are safe: retry resumes from the failed step.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {phase === 'done' ? null : !flow.isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <Button className="w-full" onClick={show}>
              Connect wallet
            </Button>
          )}
        </ConnectKitButton.Custom>
      ) : phase === 'quoted' ? (
        <Button variant="buy" className="w-full" onClick={() => void flow.execute()}>
          Confirm bridge
        </Button>
      ) : phase === 'bridging' ? (
        <Button className="w-full" loading disabled>
          Bridging...
        </Button>
      ) : phase === 'failed' ? (
        <Button variant="ghost" className="w-full" onClick={() => void flow.retry()}>
          Retry from failed step
        </Button>
      ) : (
        <Button className="w-full" loading={phase === 'quoting'} disabled={phase === 'quoting'} onClick={() => void flow.getQuote()}>
          {phase === 'error' ? 'Try again' : 'Get quote'}
        </Button>
      )}
    </div>
  )
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check className="size-4" style={{ color: 'var(--success)' }} />
  if (state === 'error') return <X className="size-4" style={{ color: 'var(--danger)' }} />
  if (state === 'running') return <Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent)' }} />
  return <span className="size-4 rounded-full border" style={{ borderColor: 'var(--border-strong)' }} />
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="capitalize" style={{ color: 'var(--subtle)' }}>
        {label}
      </span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}
