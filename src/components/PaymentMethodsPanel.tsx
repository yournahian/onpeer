import { useState } from 'react'
import { Check, CreditCard, KeyRound, Loader2, Lock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { COUNTRIES, PAYMENT_METHODS, methodsForCountry } from '@/lib/p2p'
import { BackendApiError } from '@/lib/api'
import { CountryFlag, MethodLogo } from '@/components/logos'
import {
  useP2pAccount,
  useSavedPaymentMethods,
  type SavedPaymentMethod,
} from '@/hooks/useAccount'

function generateMethodId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `pm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function currentIsoTimestamp(): string {
  return new Date().toISOString()
}

export function PaymentMethodsPanel() {
  const { isSignedIn, profile, signIn, signingIn } = useP2pAccount()
  const { methods, isLoading, saveMethods, saving } = useSavedPaymentMethods()

  const defaultCountry =
    profile?.country && COUNTRIES.some((c) => c.code === profile.country) ? profile.country : 'BD'

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [countryCode, setCountryCode] = useState<string>(defaultCountry)
  const [methodBit, setMethodBit] = useState<number>(() => methodsForCountry(defaultCountry)[0]?.bit ?? 7)
  const [holderName, setHolderName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankOrBranch, setBankOrBranch] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const openAddForm = () => {
    const c = profile?.country && COUNTRIES.some((x) => x.code === profile.country) ? profile.country : 'BD'
    const avail = methodsForCountry(c)
    setEditingId(null)
    setCountryCode(c)
    setMethodBit(avail[0]?.bit ?? 7)
    setHolderName(methods[0]?.holderName ?? '')
    setAccountNumber('')
    setBankOrBranch('')
    setNotes('')
    setFormOpen(true)
  }

  const openEditForm = (item: SavedPaymentMethod) => {
    const methodDef = PAYMENT_METHODS.find((m) => m.bit === item.methodBit)
    const matchedCountry =
      methodDef && methodDef.countries !== 'all'
        ? methodDef.countries[0] ?? defaultCountry
        : defaultCountry
    setEditingId(item.id)
    setCountryCode(matchedCountry)
    setMethodBit(item.methodBit)
    setHolderName(item.holderName)
    setAccountNumber(item.accountNumber)
    setBankOrBranch(item.bankOrBranch)
    setNotes(item.notes)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
  }

  const countryMethods = methodsForCountry(countryCode)
  const selectedMethodDef =
    PAYMENT_METHODS.find((m) => m.bit === methodBit) ?? countryMethods[0] ?? PAYMENT_METHODS[0]!

  const handleSave = async () => {
    const cleanHolder = holderName.trim()
    const cleanAcc = accountNumber.trim()
    const cleanBank = bankOrBranch.trim()
    const cleanNotes = notes.trim()

    if (cleanHolder.length < 2) {
      toast.error('Enter the account holder full name (at least 2 characters).')
      return
    }
    if (cleanAcc.length < 2) {
      toast.error('Enter your account / mobile wallet number or UPI ID.')
      return
    }

    const entry: SavedPaymentMethod = {
      id: editingId ?? generateMethodId(),
      methodBit: selectedMethodDef.bit,
      methodName: selectedMethodDef.name,
      holderName: cleanHolder,
      accountNumber: cleanAcc,
      bankOrBranch: cleanBank,
      notes: cleanNotes,
      updatedAt: currentIsoTimestamp(),
    }

    const next = editingId
      ? methods.map((m) => (m.id === editingId ? entry : m))
      : [...methods, entry]

    if (next.length > 20) {
      toast.error('You can save up to 20 payment methods.')
      return
    }

    try {
      await saveMethods(next)
      toast.success(editingId ? `${entry.methodName} updated` : `${entry.methodName} added to your P2P Account`)
      closeForm()
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not save payment method.')
    }
  }

  const handleDelete = async (id: string) => {
    const target = methods.find((m) => m.id === id)
    try {
      await saveMethods(methods.filter((m) => m.id !== id))
      setConfirmDeleteId(null)
      toast.success(target ? `${target.methodName} removed` : 'Payment method removed')
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not delete payment method.')
    }
  }

  if (!isSignedIn) {
    return (
      <section className="p2p-card rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="flex items-center gap-2 text-base font-bold text-[var(--p2p-ink)]">
              <CreditCard className="size-4 text-[#FF5A00]" />
              P2P Payment Methods
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--p2p-muted)]">
              Sign in with your wallet (free &amp; gasless) to save encrypted bKash, Nagad, Rocket, UPI, or Bank
              accounts and auto-fill them whenever you post or take P2P ads.
            </p>
          </div>
          <button
            type="button"
            disabled={signingIn}
            onClick={() =>
              void signIn().catch((err) =>
                toast.error(err instanceof BackendApiError ? err.message : 'Signature cancelled.'),
              )
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-50"
          >
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Sign In with Wallet
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header Row (SS 4 Style — High Contrast Surface Over Ribbon Backdrop) */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-4 py-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="max-w-3xl text-xs font-medium leading-relaxed text-[var(--p2p-ink)] sm:text-[13px]">
          <strong className="font-bold text-[var(--p2p-ink)]">P2P payment methods:</strong> When you sell
          cryptocurrencies, the payment method added will be displayed to buyer as options to accept payment — please
          ensure that the account owner&apos;s name is consistent with your verified name on OnPeer. You can add up to
          20 payment methods.{' '}
          <span className="ml-1 inline-flex items-center gap-1 rounded bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-bold text-[#FF5A00]">
            <Lock className="size-3" /> AES-256 Encrypted ({methods.length}/20)
          </span>
        </p>

        {!formOpen && (
          <button
            type="button"
            onClick={openAddForm}
            disabled={methods.length >= 20}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-4 text-xs font-bold text-[var(--p2p-ink)] transition-colors hover:border-[#FF5A00] hover:bg-[#FF5A00] hover:text-white disabled:opacity-40"
          >
            <Plus className="size-4" /> Add a payment method
          </button>
        )}
      </div>

      {/* Add / Edit Payment Method Form */}
      {formOpen && (
        <div className="rounded-xl border border-[#FF5A00]/60 bg-[var(--p2p-surface)] p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[var(--p2p-ink)]">
              {editingId ? `Edit ${selectedMethodDef.name}` : 'Add New Payment Method'}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Cancel"
              className="flex size-7 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* 1. Country / Market Selector */}
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              1. Select Country / Corridor
            </span>
            <div className="flex flex-wrap gap-1.5">
              {COUNTRIES.map((c) => {
                const active = c.code === countryCode
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      setCountryCode(c.code)
                      const avail = methodsForCountry(c.code)
                      if (!avail.some((m) => m.bit === methodBit) && avail[0]) {
                        setMethodBit(avail[0].bit)
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                    }`}
                  >
                    <CountryFlag code={c.code} size={14} />
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Payment Method Selector */}
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
              2. Choose Payment Method
            </span>
            <div className="flex flex-wrap gap-2">
              {countryMethods.map((m) => {
                const active = m.bit === selectedMethodDef.bit
                return (
                  <button
                    key={m.bit}
                    type="button"
                    onClick={() => setMethodBit(m.bit)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                      active
                        ? 'border-[#FF5A00] bg-[#FF5A00] text-[#FFFFFF]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)] hover:border-[var(--p2p-border-active)]'
                    }`}
                  >
                    <MethodLogo name={m.name} size={16} />
                    {m.name}
                    {active && <Check className="size-3.5" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. Account Details Inputs */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Account Holder Full Name *
              </span>
              <input
                value={holderName}
                onChange={(e) => setHolderName(e.target.value.slice(0, 80))}
                placeholder="Must match your real account name"
                className="p2p-input h-10 w-full rounded-lg !bg-[var(--p2p-surface-solid)] px-3 text-xs font-medium text-[var(--p2p-ink)]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                {selectedMethodDef.name === 'Bank transfer'
                  ? 'Bank Account Number / IBAN *'
                  : `${selectedMethodDef.name} Wallet / Account Number *`}
              </span>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.slice(0, 160))}
                placeholder={
                  selectedMethodDef.name === 'Bank transfer'
                    ? 'e.g. 1502204488990001'
                    : selectedMethodDef.name === 'UPI'
                      ? 'e.g. name@okaxis'
                      : 'e.g. 017XXXXXXXX'
                }
                className="p2p-input p2p-mono h-10 w-full rounded-lg !bg-[var(--p2p-surface-solid)] px-3 text-xs font-bold text-[var(--p2p-ink)]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                {selectedMethodDef.name === 'Bank transfer'
                  ? 'Bank Name & Branch'
                  : 'Account Type (e.g. Personal / Agent)'}
              </span>
              <input
                value={bankOrBranch}
                onChange={(e) => setBankOrBranch(e.target.value.slice(0, 120))}
                placeholder={
                  selectedMethodDef.name === 'Bank transfer'
                    ? 'e.g. City Bank, Gulshan Branch'
                    : 'e.g. Personal'
                }
                className="p2p-input h-10 w-full rounded-lg !bg-[var(--p2p-surface-solid)] px-3 text-xs text-[var(--p2p-ink)]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--p2p-muted)]">
                Remarks (Optional)
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 160))}
                placeholder="e.g. Send Money only, do not write crypto in note"
                className="p2p-input h-10 w-full rounded-lg !bg-[var(--p2p-surface-solid)] px-3 text-xs text-[var(--p2p-ink)]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={closeForm}
              className="min-h-10 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-4 text-xs font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || holderName.trim().length < 2 || accountNumber.trim().length < 2}
              onClick={() => void handleSave()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-40"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {editingId ? 'Update Method' : 'Save Payment Method'}
            </button>
          </div>
        </div>
      )}

      {/* Saved Methods Horizontal Cards (SS 4 Style) */}
      {isLoading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]" />
          <div className="h-24 animate-pulse rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]" />
        </div>
      ) : methods.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-5 py-10 text-center">
          <CreditCard className="mx-auto size-7 text-[#FF5A00]" />
          <p className="mt-2.5 text-sm font-bold text-[var(--p2p-ink)]">No Payment Methods Added Yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--p2p-muted)]">
            Add your bKash, Nagad, Rocket, UPI, or Bank account so it auto-fills whenever you post or take ads.
          </p>
          {!formOpen && (
            <button
              type="button"
              onClick={openAddForm}
              className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#FF5A00] px-4 text-xs font-bold text-[#FFFFFF] hover:opacity-90"
            >
              <Plus className="size-3.5" /> Add a payment method
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {methods.map((m) => (
            <li
              key={m.id}
              className="overflow-hidden rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)]"
            >
              {/* Top Header Bar (SS 4: | Nagad [Type] ......... Edit  Delete) */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-2 pl-2 text-xs font-bold text-[var(--p2p-ink)] sm:text-sm"
                    style={{ borderLeft: '3px solid #FF5A00' }}
                  >
                    <MethodLogo name={m.methodName} size={16} />
                    {m.methodName}
                  </span>
                  {m.bankOrBranch && (
                    <span className="rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] px-2 py-0.5 text-[11px] font-semibold text-[#FF5A00]">
                      {m.bankOrBranch}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs font-bold">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => openEditForm(m)}
                    className="text-[#FF5A00] hover:underline disabled:opacity-40"
                  >
                    Edit
                  </button>
                  {confirmDeleteId === m.id ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDelete(m.id)}
                      className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white hover:opacity-90"
                    >
                      Confirm Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmDeleteId(m.id)}
                      className="text-[#FF5A00] hover:text-red-400 hover:underline disabled:opacity-40"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Body Columns (SS 4: Wallet Number | Account Holder | Remarks) */}
              <div className="grid gap-3 px-4 py-3.5 text-xs sm:grid-cols-3">
                <div>
                  <span className="block text-[11px] text-[var(--p2p-muted)]">
                    {m.methodName === 'Bank transfer' ? 'Account Number' : `${m.methodName} Wallet Number`}
                  </span>
                  <span className="p2p-mono mt-0.5 block font-semibold text-[var(--p2p-ink)]">
                    {m.accountNumber}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] text-[var(--p2p-muted)]">Account Holder</span>
                  <span className="mt-0.5 block font-semibold text-[var(--p2p-ink)]">{m.holderName}</span>
                </div>

                <div>
                  <span className="block text-[11px] text-[var(--p2p-muted)]">Remarks</span>
                  <span className="mt-0.5 block text-[var(--p2p-ink)]">{m.notes || m.bankOrBranch || '—'}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
