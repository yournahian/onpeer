import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { AppLink } from '@/components/AppLink'
import { BackendApiError } from '@/lib/api'
import { CHAIN_ID } from '@/lib/p2p'
import { useKycStatus } from '@/hooks/useAccount'

export function KycPanel() {
  const { isSignedIn, data, isLoading, refetch, startKyc, starting } = useKycStatus()
  const [scenario, setScenario] = useState('approve')
  const [consentChecked, setConsentChecked] = useState(false)
  const [hostedUrl, setHostedUrl] = useState<string | null>(null)

  if (!isSignedIn) return null
  if (isLoading && !data) {
    return <div className="p2p-card h-36 animate-pulse rounded-xl" />
  }
  if (!data) return null

  const isSandbox = data.mode === 'sandbox'
  const titleLabel = isSandbox ? 'Test KYC (Didit Sandbox)' : 'Identity Verification (KYC)'
  const hasConsent = data.hasConsent || consentChecked

  const handleStart = async () => {
    if (!hasConsent) {
      toast.error('Please accept the Privacy & Verification Notice before starting.')
      return
    }
    try {
      const res = await startKyc({
        consent: true,
        ...(isSandbox && scenario ? { sandboxScenario: scenario } : {}),
      })
      setHostedUrl(res.url)
      window.open(res.url, '_blank', 'noopener,noreferrer')
      toast.success(
        isSandbox
          ? 'Opened Didit Test KYC in a new tab. Complete the simulated flow there.'
          : 'Opened Didit verification in a new tab.',
      )
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not start KYC session.')
    }
  }

  return (
    <section className="p2p-card rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p2p-border)] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[var(--p2p-ink)]">{titleLabel}</h2>
            {data.kycStatus === 'approved' && data.onchainVerified ? (
              <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--p2p-ok-ink)]">
                <CheckCircle2 className="size-3.5" /> Verified Onchain (L{data.kycLevel})
              </span>
            ) : data.kycStatus === 'approved' ? (
              <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--p2p-accent-ink)]">
                <Clock className="size-3.5" /> Approved — Syncing Onchain
              </span>
            ) : data.kycStatus === 'declined' || data.kycStatus === 'expired' || data.kycStatus === 'revoked' ? (
              <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-danger-border)] bg-[var(--p2p-danger-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--p2p-danger-ink)]">
                <XCircle className="size-3.5" /> {data.kycStatus.toUpperCase()}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--p2p-muted)]">
                <ShieldCheck className="size-3.5" /> {data.kycStatus.toUpperCase()}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-xs text-[var(--p2p-muted)]">
            {isSandbox
              ? 'Sandbox verification for P2P trading and payment name-matching. Do not upload real passports or government IDs.'
              : 'Verify your identity with Didit to unlock KYC-gated P2P trading and third-party payment name protection.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-semibold text-[var(--p2p-muted)] hover:border-[#FF5A00] hover:text-[var(--p2p-ink)]"
        >
          <RefreshCw className="size-3.5" /> Refresh Status
        </button>
      </div>

      {isSandbox && (
        <div
          className="flex items-start gap-2.5 rounded-lg bg-[var(--p2p-tint)] px-3.5 py-2.5 text-xs text-[var(--p2p-ink)]"
          style={{ borderLeft: '3px solid #FF5A00' }}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#FF5A00]" />
          <p>
            <strong className="text-[#FF5A00]">Sandbox Test Mode:</strong> Pick a deterministic Didit test scenario
            below. Never submit real identity documents on Arc Testnet.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
          <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Backend Status</span>
          <span className="p2p-mono mt-1 block text-sm font-bold text-[var(--p2p-ink)]">
            {data.kycStatus.toUpperCase()}
            {data.kycLevel > 0 ? ` (Level ${data.kycLevel})` : ''}
          </span>
        </div>

        <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
          <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Arc Escrow Status</span>
          <span className="p2p-mono mt-1 block text-sm font-bold text-[var(--p2p-ink)]">
            {data.onchainVerified ? 'VERIFIED ONCHAIN' : 'NOT VERIFIED'}
          </span>
        </div>

        <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
          <span className="block text-[10px] uppercase tracking-wider text-[var(--p2p-muted)]">Valid Until</span>
          <span className="p2p-mono mt-1 block text-sm font-bold text-[var(--p2p-ink)]">
            {data.kycExpiresAt ? data.kycExpiresAt.slice(0, 10) : '—'}
          </span>
        </div>
      </div>

      {data.latestJob && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 py-2 text-xs text-[var(--p2p-muted)]">
          <span>
            Relayer job (<span className="p2p-mono text-[var(--p2p-ink)]">{data.latestJob.kind}</span>):{' '}
            <strong className="text-[var(--p2p-ink)]">{data.latestJob.status}</strong>
            {data.latestJob.lastError && ` • ${data.latestJob.lastError}`}
          </span>
          {data.latestJob.txHash && (
            <a
              href={buildTxExplorerUrl(CHAIN_ID, data.latestJob.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#FF5A00] underline"
            >
              View Arc Tx <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {data.kycStatus === 'approved' || data.onchainVerified ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-4 py-3 text-xs font-semibold text-[var(--p2p-ok-ink)]">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            {data.onchainVerified
              ? `Your identity is verified on Arc (Level ${Math.max(1, data.kycLevel)}). No further KYC session is needed.`
              : 'Your KYC is approved and currently syncing to the Arc escrow contract.'}
          </span>
        </div>
      ) : data.kycStatus === 'pending' || data.kycStatus === 'in_review' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-4 py-3 text-xs text-[var(--p2p-ink)]">
          <span className="inline-flex items-center gap-2 font-semibold text-[#FF5A00]">
            <Clock className="size-4 shrink-0" />
            Verification session is {data.kycStatus === 'in_review' ? 'in review' : 'in progress'}.
          </span>
          {hostedUrl && (
            <a
              href={hostedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 py-2 text-xs font-bold text-white"
            >
              Continue Verification <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      ) : (
        <>
          {/* Scenario picker rendered ONLY when DIDIT_MODE=sandbox and not yet verified */}
          {isSandbox && data.scenarios.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Sandbox Test Scenario
              </span>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="p2p-input h-10 w-full rounded-lg px-3 text-xs font-medium text-[var(--p2p-ink)]"
              >
                {data.scenarios.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label} ({s.slug})
                  </option>
                ))}
              </select>
            </label>
          )}

          {!data.hasConsent && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs text-[var(--p2p-muted)]">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
              />
              <span>
                I consent to share test verification data with Didit under Didit&apos;s privacy notice and the{' '}
                <AppLink to="/privacy" className="font-semibold text-[#FF5A00] underline">
                  OnPeer Privacy &amp; Encryption Notice
                </AppLink>
                .
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={starting || !hasConsent}
              onClick={() => void handleStart()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
            >
              {starting ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
              {starting
                ? 'Starting Session...'
                : data.kycStatus === 'declined' || data.kycStatus === 'expired' || data.kycStatus === 'revoked'
                  ? 'Retry KYC Verification'
                  : isSandbox
                    ? 'Start Test KYC'
                    : 'Start KYC Verification'}
            </button>

            {hostedUrl && (
              <a
                href={hostedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-3.5 text-xs font-bold text-[#FF5A00]"
              >
                Re-open Verification Link <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </>
      )}
    </section>
  )
}
