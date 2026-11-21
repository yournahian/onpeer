import { useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, LogOut, Mail, ShieldCheck, Trash2, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AppLink } from '@/components/AppLink'
import { COUNTRIES } from '@/lib/p2p'
import { BackendApiError } from '@/lib/api'
import { useP2pAccount, type P2pAccountProfile, type UpsertAccountInput } from '@/hooks/useAccount'

export function AccountSetup() {
  const {
    isSignedIn,
    profile,
    isLoading,
    signIn,
    signingIn,
    signOut,
    saveAccount,
    saving,
    resendVerification,
    resending,
    deleteAccount,
    deleting,
  } = useP2pAccount()

  const handleSignIn = async () => {
    try {
      await signIn()
      toast.success('Signed in to P2P Account')
    } catch (err) {
      const msg = err instanceof BackendApiError ? err.message : 'Wallet signature was cancelled.'
      toast.error(msg)
    }
  }

  if (!isSignedIn) {
    return (
      <section className="p2p-card rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <UserCheck className="size-4 text-[#FF5A00]" />
              <h2 className="text-base font-bold text-[var(--p2p-ink)]">P2P Account, Encrypted Vault &amp; Alerts</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--p2p-muted)]">
              Sign a free, gasless message with your wallet to manage your P2P profile, encrypted payment details,
              offchain chat, dispute filings, and optional email notifications. Review our{' '}
              <AppLink to="/privacy" className="font-semibold text-[#FF5A00] underline">
                Privacy &amp; Encryption Notice
              </AppLink>
              .
            </p>
          </div>
          <button
            type="button"
            disabled={signingIn}
            onClick={() => void handleSignIn()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-50"
          >
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {signingIn ? 'Signing In...' : 'Sign In with Wallet'}
          </button>
        </div>
      </section>
    )
  }

  if (isLoading && !profile) {
    return <div className="p2p-card h-44 animate-pulse rounded-xl" />
  }

  const formKey = `${profile?.wallet ?? ''}|${profile?.displayName ?? ''}|${profile?.country ?? ''}|${profile?.emailMasked ?? ''}|${String(profile?.emailOptIn)}|${profile?.consentAt ?? ''}`

  return (
    <AccountSetupForm
      key={formKey}
      profile={profile}
      saving={saving}
      resending={resending}
      deleting={deleting}
      onSignOut={signOut}
      onSave={saveAccount}
      onResend={resendVerification}
      onDelete={deleteAccount}
    />
  )
}

function AccountSetupForm({
  profile,
  saving,
  resending,
  deleting,
  onSignOut,
  onSave,
  onResend,
  onDelete,
}: {
  profile: P2pAccountProfile | null
  saving: boolean
  resending: boolean
  deleting: boolean
  onSignOut: () => Promise<void>
  onSave: (input: UpsertAccountInput) => Promise<P2pAccountProfile>
  onResend: () => Promise<{ queued: boolean; reason?: string }>
  onDelete: () => Promise<{ ok: boolean }>
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [country, setCountry] = useState(profile?.country ?? 'BD')
  const [email, setEmail] = useState('')
  const [emailOptIn, setEmailOptIn] = useState(profile?.emailOptIn ?? true)
  const [consent, setConsent] = useState(!!profile?.consentAt)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isSandbox = profile?.diditMode !== 'live'
  const kycBadgeLabel = isSandbox ? 'Test KYC' : 'KYC'

  const handleSave = async () => {
    if (!consent && !profile?.consentAt) {
      toast.error('Please review and accept the Privacy & Sandbox Notice first.')
      return
    }
    try {
      const trimmedEmail = email.trim()
      const res = await onSave({
        displayName: displayName.trim() || null,
        country: country || null,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        emailOptIn,
        consent: true,
      })
      setEmail('')
      if (res.verificationEmail) {
        if (res.verificationEmail.queued) {
          toast.success('Profile saved — check your inbox to confirm your email.')
        } else if (res.verificationEmail.reason === 'email_send_failed') {
          toast.error('Profile saved, but Resend rejected the verification email. Check EMAIL_FROM & Resend logs.')
        } else {
          toast.info('Profile saved. Email confirmation will be available once Resend is configured.')
        }
      } else {
        toast.success('P2P Account saved')
      }
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not save account.')
    }
  }

  const handleClearEmail = async () => {
    try {
      await onSave({ email: '', emailOptIn: false, consent: true })
      setEmail('')
      toast.success('Email address removed')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not remove email.')
    }
  }

  const handleResend = async () => {
    try {
      const res = await onResend()
      if (res.queued) toast.success('Verification email sent.')
      else if (res.reason === 'email_send_failed') {
        toast.error('Resend rejected the verification email. Check EMAIL_FROM & Resend logs.')
      } else toast.info('Email sender is not configured on this environment yet.')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not resend verification email.')
    }
  }

  const handleDelete = async () => {
    try {
      await onDelete()
      setConfirmDelete(false)
      toast.success('Account deleted and personal data scrubbed.')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not delete account.')
    }
  }

  return (
    <section className="p2p-card rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p2p-border)] pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[var(--p2p-ink)]">P2P Account &amp; Alert Preferences</h2>
            <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
              <ShieldCheck className="size-3.5" />
              {kycBadgeLabel}: {(profile?.kycStatus ?? 'none').toUpperCase()}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--p2p-muted)]">
            Encrypted offchain profile for P2P trading. Payment details use server-side envelope encryption (
            <AppLink to="/privacy" className="font-semibold text-[#FF5A00] underline">
              read trust &amp; privacy notice
            </AppLink>
            ).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-semibold text-[var(--p2p-muted)] hover:border-[#FF5A00] hover:text-[var(--p2p-ink)]"
        >
          <LogOut className="size-3.5" /> Sign Out
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
            Display Alias (Optional)
          </span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={48}
            placeholder="e.g. DhakaDesk"
            className="p2p-input h-10 w-full rounded-lg px-3 text-xs font-medium text-[var(--p2p-ink)]"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
            Country / Market
          </span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="p2p-input h-10 w-full rounded-lg px-3 text-xs font-medium text-[var(--p2p-ink)]"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code.toUpperCase()}>
                {c.name} ({c.currency})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-[#FF5A00]" />
            <span className="text-xs font-bold text-[var(--p2p-ink)]">Email Notifications (Double Opt-In)</span>
          </div>
          {profile?.hasEmail && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="p2p-mono text-[var(--p2p-ink)]">{profile.emailMasked}</span>
              {profile.emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-400">
                  <CheckCircle2 className="size-3" /> Verified
                </span>
              ) : (
                <>
                  <span className="rounded bg-[var(--p2p-tint)] px-2 py-0.5 font-bold text-[#FF5A00]">
                    Unverified
                  </span>
                  <button
                    type="button"
                    disabled={resending}
                    onClick={() => void handleResend()}
                    className="font-semibold text-[#FF5A00] underline disabled:opacity-50"
                  >
                    {resending ? 'Sending...' : 'Resend link'}
                  </button>
                </>
              )}
              {!profile.emailVerified && (
                <button
                  type="button"
                  onClick={() => void handleClearEmail()}
                  className="text-[var(--p2p-muted)] underline hover:text-[var(--p2p-ink)]"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          {profile?.emailVerified ? (
            <div className="flex h-10 items-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-3 text-xs text-[var(--p2p-muted)]">
              Verified email is locked. To change your email, please contact support.
            </div>
          ) : (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              placeholder={
                profile?.hasEmail
                  ? `Fix / replace ${profile.emailMasked ?? 'saved email'}...`
                  : 'you@example.com (required to unlock P2P)'
              }
              className="p2p-input h-10 w-full rounded-lg px-3 text-xs text-[var(--p2p-ink)]"
            />
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--p2p-ink)]">
            <input
              type="checkbox"
              checked={emailOptIn}
              onChange={(e) => setEmailOptIn(e.target.checked)}
              className="size-4 accent-[#FF5A00]"
            />
            <span>Send order &amp; dispute alerts</span>
          </label>
        </div>
        <p className="text-[11px] text-[var(--p2p-muted)]">
          Alerts contain only the order ID and a link—never payment details, names, or chat messages. Every email
          includes a one-click unsubscribe link.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3 text-xs text-[var(--p2p-muted)]">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
        />
        <span>
          I have read and accept the{' '}
          <AppLink to="/privacy" className="font-semibold text-[#FF5A00] underline">
            OnPeer Privacy &amp; Encryption Notice
          </AppLink>{' '}
          (including that payment details use operator-held envelope keys in Mode 2 and that testnet KYC uses Didit
          Sandbox with test data only).
          {profile?.consentAt && (
            <span className="p2p-mono ml-1 text-[11px] text-[var(--p2p-ink)]">
              • Accepted {new Date(profile.consentAt).toISOString().slice(0, 10)}
            </span>
          )}
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          disabled={saving || (!consent && !profile?.consentAt)}
          onClick={() => void handleSave()}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save Account Settings
        </button>

        {profile?.exists && (
          <div className="flex items-center gap-2">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] px-3 text-xs font-semibold text-[var(--p2p-muted)] hover:border-red-500/60 hover:text-red-400"
              >
                <Trash2 className="size-3.5" /> Delete Account
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {deleting && <Loader2 className="size-3.5 animate-spin" />}
                  Confirm Scrub &amp; Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-[var(--p2p-muted)] underline"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
