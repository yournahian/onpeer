import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Unlink,
  UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { AppLink } from '@/components/AppLink'
import { CountryFlag } from '@/components/logos'
import { COUNTRIES } from '@/lib/p2p'
import { BackendApiError } from '@/lib/api'
import {
  getTelegramInitData,
  getTelegramMiniAppUser,
  isTelegramMiniApp,
  openTelegramUrl,
  triggerTelegramHaptic,
} from '@/lib/telegram'
import { useP2pAccount, useTelegramAlerts, type P2pAccountProfile, type UpsertAccountInput } from '@/hooks/useAccount'

const ONBOARD_STAGE_PREFIX = 'onpeer:p2p-onboard-stage:'

export function getOnboardingStage(wallet: string | null | undefined): 'step2' | 'done' | null {
  if (!wallet || typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(`${ONBOARD_STAGE_PREFIX}${wallet.toLowerCase()}`)
    return v === 'step2' || v === 'done' ? v : null
  } catch {
    return null
  }
}

export function setOnboardingStage(wallet: string | null | undefined, stage: 'step2' | 'done'): void {
  if (!wallet || typeof window === 'undefined') return
  try {
    localStorage.setItem(`${ONBOARD_STAGE_PREFIX}${wallet.toLowerCase()}`, stage)
  } catch {
    // ignore storage errors
  }
}

function CountryDropdown({
  value,
  onChange,
}: {
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = COUNTRIES.find((c) => c.code.toUpperCase() === value.toUpperCase()) ?? COUNTRIES[0]!

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`p2p-input flex h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-xs font-semibold text-[var(--p2p-ink)] transition-colors ${
          open ? 'border-[#FF5A00]' : ''
        }`}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <CountryFlag code={selected.code} size={18} />
          <span className="truncate">{selected.name}</span>
          <span className="p2p-mono text-[11px] text-[var(--p2p-muted)]">({selected.currency})</span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-[var(--p2p-muted)] transition-transform ${open ? 'rotate-180 text-[#FF5A00]' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="p2p-glass-popover absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-xl border border-[var(--p2p-border-active)] p-1.5 shadow-2xl"
        >
          {COUNTRIES.map((c) => {
            const active = c.code.toUpperCase() === selected.code.toUpperCase()
            return (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(c.code.toUpperCase())
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--p2p-tint)] text-[#FF5A00]'
                    : 'text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <CountryFlag code={c.code} size={18} />
                  <span>{c.name}</span>
                  <span className="p2p-mono text-[11px] opacity-75">({c.currency})</span>
                </span>
                {active && <Check className="size-3.5 shrink-0 text-[#FF5A00]" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AccountSetup({
  onboarding = false,
  onOnboardingComplete,
}: {
  onboarding?: boolean
  onOnboardingComplete?: () => void
}) {
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
      <section className="p2p-card rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-md space-y-1">
            <div className="flex items-center gap-2">
              <UserCheck className="size-4 text-[#FF5A00]" />
              <h2 className="text-base font-bold text-[var(--p2p-ink)]">Sign In to P2P</h2>
            </div>
            <p className="text-xs text-[var(--p2p-muted)]">
              Sign a free, gasless wallet message to continue.
            </p>
          </div>
          <button
            type="button"
            disabled={signingIn}
            onClick={() => void handleSignIn()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-50"
          >
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {signingIn ? 'Signing In...' : 'Sign In with Wallet'}
          </button>
        </div>
      </section>
    )
  }

  if (isLoading && !profile) {
    return <div className="p2p-card h-44 animate-pulse rounded-2xl" />
  }

  const formKey = `${profile?.wallet ?? ''}|${profile?.displayName ?? ''}|${profile?.country ?? ''}|${profile?.emailMasked ?? ''}|${String(profile?.emailVerified)}|${String(profile?.emailOptIn)}|${profile?.consentAt ?? ''}`

  return (
    <AccountSetupForm
      key={formKey}
      onboarding={onboarding}
      profile={profile}
      saving={saving}
      resending={resending}
      deleting={deleting}
      onSignOut={signOut}
      onSave={saveAccount}
      onResend={resendVerification}
      onDelete={deleteAccount}
      onOnboardingComplete={onOnboardingComplete}
    />
  )
}

function AccountSetupForm({
  onboarding,
  profile,
  saving,
  resending,
  deleting,
  onSignOut,
  onSave,
  onResend,
  onDelete,
  onOnboardingComplete,
}: {
  onboarding: boolean
  profile: P2pAccountProfile | null
  saving: boolean
  resending: boolean
  deleting: boolean
  onSignOut: () => Promise<void>
  onSave: (input: UpsertAccountInput) => Promise<P2pAccountProfile>
  onResend: () => Promise<{ queued: boolean; reason?: string }>
  onDelete: () => Promise<{ ok: boolean }>
  onOnboardingComplete?: () => void
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [country, setCountry] = useState(profile?.country ?? 'BD')
  const [email, setEmail] = useState('')
  const [emailOptIn, setEmailOptIn] = useState(profile?.emailOptIn ?? true)
  const [consent, setConsent] = useState(onboarding ? false : !!profile?.consentAt)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isEmailVerified = !!profile?.emailVerified
  const isSandbox = profile?.diditMode !== 'live'
  const kycBadgeLabel = isSandbox ? 'Test KYC' : 'KYC'

  const handleSendVerifyEmail = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail && !profile?.hasEmail) {
      toast.error('Enter your email address to verify.')
      return
    }
    try {
      const res = await onSave({
        displayName: displayName.trim() || null,
        country: country || null,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        emailOptIn: true,
        consent: true,
      })
      setOnboardingStage(res.wallet, 'step2')
      setEmail('')
      if (res.verificationEmail?.queued) {
        toast.success('Verification link sent — check your inbox.')
      } else if (res.verificationEmail?.reason === 'email_send_failed') {
        toast.error('Could not deliver email. Please check the address and retry.')
      } else if (!trimmedEmail && profile?.hasEmail) {
        await handleResend()
      } else {
        toast.success('Profile saved.')
      }
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not save profile.')
    }
  }

  const handleCompleteOnboarding = async () => {
    if (!consent) {
      toast.error('Please accept the Privacy & Encryption Notice to continue.')
      return
    }
    try {
      const res = await onSave({
        emailOptIn,
        consent: true,
      })
      setOnboardingStage(res.wallet, 'done')
      toast.success('Welcome to OnPeer P2P!')
      onOnboardingComplete?.()
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not complete setup.')
    }
  }

  const handleSaveSettings = async () => {
    if (!consent && !profile?.consentAt) {
      toast.error('Please accept the Privacy & Encryption Notice first.')
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
      if (res.verificationEmail?.queued) {
        toast.success('Saved — check your inbox to verify your email.')
      } else {
        toast.success('Account settings saved')
      }
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not save account.')
    }
  }

  const handleClearEmail = async () => {
    try {
      await onSave({ email: '', emailOptIn: false, consent: true })
      setEmail('')
      toast.success('Email removed')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not remove email.')
    }
  }

  const handleResend = async () => {
    try {
      const res = await onResend()
      if (res.queued) toast.success('Verification link resent — check your inbox.')
      else if (res.reason === 'email_send_failed') {
        toast.error('Email delivery failed. Please try again.')
      } else toast.info('Email sender is not configured on this environment yet.')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not resend link.')
    }
  }

  const handleDelete = async () => {
    try {
      await onDelete()
      setConfirmDelete(false)
      toast.success('Account deleted.')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not delete account.')
    }
  }

  // =========================================================================
  // ONBOARDING 2-STEP FLOW (Clean, Minimal, Uncluttered)
  // Step 1: Profile + Email Verification -> Step 2: Telegram Alerts + Privacy Notice
  // =========================================================================
  if (onboarding) {
    const activeStep = isEmailVerified ? 2 : 1

    return (
      <section className="p2p-card rounded-2xl p-5 sm:p-6 space-y-5">
        {/* Compact Header + 2-Step Indicator */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p2p-border)] pb-4">
          <div>
            <h1 className="text-lg font-extrabold text-[var(--p2p-ink)]">
              {activeStep === 1 ? 'Verify Your Email' : 'Alerts & Privacy'}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--p2p-muted)]">
              {activeStep === 1
                ? 'Step 1 of 2 — Set your profile and verify your email to continue.'
                : 'Step 2 of 2 — Optional instant alerts and privacy confirmation.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-2.5 text-xs font-semibold text-[var(--p2p-muted)] hover:border-[#FF5A00] hover:text-[var(--p2p-ink)]"
          >
            <LogOut className="size-3.5" /> Sign Out
          </button>
        </div>

        {/* 2-Step Progress Pills */}
        <div className="grid grid-cols-2 gap-2">
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${
              activeStep === 1
                ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                : 'border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] text-[var(--p2p-ok-ink)]'
            }`}
          >
            <span
              className={`p2p-mono flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                activeStep === 1 ? 'bg-[#FF5A00] text-white' : 'bg-emerald-500 text-white'
              }`}
            >
              {activeStep > 1 ? <Check className="size-3" /> : '1'}
            </span>
            <span>Email Verification</span>
          </div>
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${
              activeStep === 2
                ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
            }`}
          >
            <span
              className={`p2p-mono flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                activeStep === 2
                  ? 'bg-[#FF5A00] text-white'
                  : 'border border-[var(--p2p-border)] text-[var(--p2p-muted)]'
              }`}
            >
              2
            </span>
            <span>Alerts &amp; Privacy</span>
          </div>
        </div>

        {activeStep === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
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

              <div className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                  Country / Market
                </span>
                <CountryDropdown value={country} onChange={setCountry} />
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                  Email Address
                </span>
                {profile?.hasEmail && (
                  <span className="inline-flex items-center gap-1.5 text-[11px]">
                    <span className="p2p-mono text-[var(--p2p-ink)]">{profile.emailMasked}</span>
                    <span className="rounded bg-[var(--p2p-tint)] px-2 py-0.5 font-bold text-[#FF5A00]">
                      Pending
                    </span>
                  </span>
                )}
              </div>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                placeholder={
                  profile?.hasEmail
                    ? `Change ${profile.emailMasked ?? 'email'}...`
                    : 'you@example.com'
                }
                className="p2p-input h-11 w-full rounded-lg px-3.5 text-sm text-[var(--p2p-ink)]"
              />

              {profile?.hasEmail && (
                <p className="text-xs text-[var(--p2p-muted)]">
                  Check your inbox (or Spam folder) and click the verification link to unlock Step 2.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={saving || (!email.trim() && !profile?.hasEmail)}
                onClick={() => void handleSendVerifyEmail()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                {profile?.hasEmail && !email.trim() ? 'Save Profile' : 'Send Verification Email'}
              </button>

              {profile?.hasEmail && (
                <button
                  type="button"
                  disabled={resending}
                  onClick={() => void handleResend()}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[#FF5A00] hover:bg-[var(--p2p-tint)] disabled:opacity-40"
                >
                  {resending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  {resending ? 'Sending...' : 'Resend Link'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-3.5 py-2.5 text-xs">
              <span className="inline-flex items-center gap-2 font-bold text-[var(--p2p-ok-ink)]">
                <CheckCircle2 className="size-4" />
                Email Verified
              </span>
              {profile?.emailMasked && (
                <span className="p2p-mono text-[var(--p2p-ok-ink)]">{profile.emailMasked}</span>
              )}
            </div>

            <TelegramAlertsCard compact />

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 text-xs text-[var(--p2p-ink)]">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[#FF5A00]"
              />
              <span>
                I have read and accept the{' '}
                <AppLink to="/privacy" className="font-bold text-[#FF5A00] underline">
                  OnPeer Privacy &amp; Encryption Notice
                </AppLink>
                .
              </span>
            </label>

            <button
              type="button"
              disabled={saving || !consent}
              onClick={() => void handleCompleteOnboarding()}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-sm font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Continue to P2P Market
              <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </section>
    )
  }

  // =========================================================================
  // SETTINGS MODE (User Center -> Notification Settings)
  // =========================================================================
  return (
    <section className="p2p-card rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p2p-border)] pb-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-[var(--p2p-ink)]">Account &amp; Alerts</h2>
          <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
            <ShieldCheck className="size-3.5" />
            {kycBadgeLabel}: {(profile?.kycStatus ?? 'none').toUpperCase()}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 text-xs font-semibold text-[var(--p2p-muted)] hover:border-[#FF5A00] hover:text-[var(--p2p-ink)]"
        >
          <LogOut className="size-3.5" /> Sign Out
        </button>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
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

        <div className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
            Country / Market
          </span>
          <CountryDropdown value={country} onChange={setCountry} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-[#FF5A00]" />
            <span className="text-xs font-bold text-[var(--p2p-ink)]">Email Alerts</span>
          </div>
          {profile?.hasEmail && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="p2p-mono text-[var(--p2p-ink)]">{profile.emailMasked}</span>
              {profile.emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-2 py-0.5 font-bold text-[var(--p2p-ok-ink)]">
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
                  <button
                    type="button"
                    onClick={() => void handleClearEmail()}
                    className="text-[var(--p2p-muted)] underline hover:text-[var(--p2p-ink)]"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {!profile?.emailVerified && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              placeholder={profile?.hasEmail ? `Replace ${profile.emailMasked ?? 'email'}...` : 'you@example.com'}
              className="p2p-input h-9 min-w-[200px] flex-1 rounded-lg px-3 text-xs text-[var(--p2p-ink)]"
            />
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--p2p-ink)]">
            <input
              type="checkbox"
              checked={emailOptIn}
              onChange={(e) => setEmailOptIn(e.target.checked)}
              className="size-4 accent-[#FF5A00]"
            />
            <span>Order &amp; dispute email alerts</span>
          </label>
        </div>
      </div>

      <TelegramAlertsCard compact />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSaveSettings()}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save Changes
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
                  Confirm Delete
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

function TelegramAlertsCard({ compact = false }: { compact?: boolean }) {
  const [waitingForBotStart, setWaitingForBotStart] = useState(false)
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null)
  const {
    status,
    isLoading,
    linkMiniApp,
    linkingMiniApp,
    mintLinkToken,
    mintingToken,
    setOptIn,
    updatingOptIn,
    sendTest,
    sendingTest,
    unlink,
    unlinking,
  } = useTelegramAlerts(waitingForBotStart)

  const inMiniApp = isTelegramMiniApp()
  const miniAppUser = getTelegramMiniAppUser()

  useEffect(() => {
    if (status?.linked && waitingForBotStart) {
      // eslint-disable-next-line react/set-state-in-effect
      setWaitingForBotStart(false)
      setPendingDeepLink(null)
      toast.success('Telegram Bot connected! Instant trade alerts are now active.')
    }
  }, [status?.linked, waitingForBotStart])

  useEffect(() => {
    if (!waitingForBotStart) return
    const timer = window.setTimeout(() => {
      setWaitingForBotStart(false)
    }, 120_000)
    return () => window.clearTimeout(timer)
  }, [waitingForBotStart])

  const handleLinkInMiniApp = async () => {
    const initData = getTelegramInitData()
    if (!initData) {
      toast.error('Telegram session data unavailable. Reopen the Mini App from Telegram.')
      return
    }
    try {
      const res = await linkMiniApp(initData)
      triggerTelegramHaptic('success')
      toast.success(
        res.allowsWriteToPm
          ? 'Telegram connected! Check your bot chat for confirmation.'
          : 'Telegram linked! Send /start to the bot chat once so it can message you.',
      )
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not link Telegram Mini App.')
    }
  }

  const handleConnectBotWeb = async () => {
    try {
      const res = await mintLinkToken()
      setPendingDeepLink(res.deepLink)
      setWaitingForBotStart(true)
      openTelegramUrl(res.deepLink)
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not create Telegram link.')
    }
  }

  const handleToggleOptIn = async (next: boolean) => {
    try {
      await setOptIn(next)
      toast.success(next ? 'Telegram alerts enabled' : 'Telegram alerts paused')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not update Telegram alert preference.')
    }
  }

  const handleSendTest = async () => {
    try {
      await sendTest()
      toast.success('Test alert sent to your Telegram!')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not send Telegram test alert.')
    }
  }

  const handleUnlink = async () => {
    try {
      await unlink()
      setWaitingForBotStart(false)
      setPendingDeepLink(null)
      toast.success('Telegram disconnected.')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not unlink Telegram.')
    }
  }

  return (
    <div className="rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Send className="size-4 text-[#FF5A00]" />
          <span className="text-xs font-bold text-[var(--p2p-ink)]">Telegram Instant Trade &amp; Chat Alerts</span>
        </div>

        {status?.linked && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {status.username && (
              <span className="p2p-mono text-[var(--p2p-ink)]">@{status.username}</span>
            )}
            <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-ok-border)] bg-[var(--p2p-ok-bg)] px-2 py-0.5 font-bold text-[var(--p2p-ok-ink)]">
              <CheckCircle2 className="size-3" /> Connected
            </span>
          </div>
        )}
      </div>

      {isLoading && !status ? (
        <p className="text-xs text-[var(--p2p-muted)]">Checking Telegram connection...</p>
      ) : status?.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--p2p-ink)]">
            <input
              type="checkbox"
              checked={status.optIn}
              disabled={updatingOptIn}
              onChange={(e) => void handleToggleOptIn(e.target.checked)}
              className="size-4 accent-[#FF5A00]"
            />
            <span>Instant push for orders, escrow releases, chat &amp; disputes</span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={sendingTest || !status.optIn}
              onClick={() => void handleSendTest()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-3 text-[11px] font-bold text-[#FF5A00] hover:opacity-90 disabled:opacity-40"
            >
              {sendingTest ? <Loader2 className="size-3 animate-spin" /> : <BellRing className="size-3" />}
              Test Alert
            </button>
            <button
              type="button"
              disabled={unlinking}
              onClick={() => void handleUnlink()}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--p2p-border)] px-2.5 text-[11px] font-semibold text-[var(--p2p-muted)] hover:border-red-500/60 hover:text-red-400 disabled:opacity-40"
            >
              {unlinking ? <Loader2 className="size-3 animate-spin" /> : <Unlink className="size-3" />}
              Unlink
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs text-[var(--p2p-muted)]">
            {compact
              ? 'Get instant order, payment, and chat notifications on Telegram.'
              : 'Get real-time phone notifications with one-tap order room launch whenever someone opens an order, marks payment as Paid, or sends an encrypted chat message.'}
          </p>

          {inMiniApp ? (
            <button
              type="button"
              disabled={linkingMiniApp}
              onClick={() => void handleLinkInMiniApp()}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {linkingMiniApp ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {miniAppUser?.username ? `Link @${miniAppUser.username}` : 'Link Telegram'}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={mintingToken}
                onClick={() => void handleConnectBotWeb()}
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {mintingToken ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {waitingForBotStart ? 'Waiting for /start…' : 'Connect Telegram Bot'}
                <ExternalLink className="size-3" />
              </button>
              {pendingDeepLink && waitingForBotStart && (
                <a
                  href={pendingDeepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-[#FF5A00] underline"
                >
                  Open link again
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {!compact && (
        <p className="text-[11px] text-[var(--p2p-muted)]">
          Zero-PII protection: Telegram IDs are AES-256-GCM encrypted at rest, and bot messages never include bank/mobile
          account numbers, real names, or chat plaintext.
        </p>
      )}
    </div>
  )
}
