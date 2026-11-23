import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, X } from 'lucide-react'
import { COUNTRIES, methodsForCountry, type Country } from '@/lib/p2p'
import { CountryFlag } from '@/components/logos'
import { DEFAULT_P2P_FILTER, type SavedP2pFilterState } from '@/hooks/useSocial'

function ToggleSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--p2p-ink)]">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-[var(--p2p-muted)]">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-[#FF5A00]' : 'bg-[var(--p2p-border)]'
        }`}
      >
        <span
          className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function amountPresetsFor(country: Country): { label: string; value: string }[] {
  const s = country.symbol
  return [
    { label: `${s}1,000`, value: '1000' },
    { label: `${s}5K`, value: '5000' },
    { label: `${s}25K`, value: '25000' },
    { label: `${s}50K`, value: '50000' },
  ]
}

export function MarketFilterSheet({
  open,
  countryCode,
  amount,
  method,
  filterState,
  onApply,
  onClose,
}: {
  open: boolean
  countryCode: string
  amount: string
  method: number | null
  filterState: SavedP2pFilterState
  onApply: (next: {
    countryCode: string
    amount: string
    method: number | null
    filterState: SavedP2pFilterState
  }) => void
  onClose: () => void
}) {
  const [draftCountry, setDraftCountry] = useState(countryCode)
  const [draftAmount, setDraftAmount] = useState(amount)
  const [draftMethod, setDraftMethod] = useState<number | null>(method)
  const [draft, setDraft] = useState<SavedP2pFilterState>(filterState)

  if (typeof document === 'undefined') return null

  const country = COUNTRIES.find((c) => c.code === draftCountry) ?? COUNTRIES[0]!
  const methods = methodsForCountry(country.code)
  const presets = amountPresetsFor(country)
  const windows: Array<number | null> = [null, 15, 30, 45, 60]

  const handleReset = () => {
    setDraftAmount('')
    setDraftMethod(null)
    setDraft({ ...DEFAULT_P2P_FILTER, saveForNextUse: draft.saveForNextUse })
  }

  const handleConfirm = () => {
    onApply({
      countryCode: draftCountry,
      amount: draftAmount,
      method: draftMethod,
      filterState: draft,
    })
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="p2p-terminal fixed inset-0 z-[75] flex justify-end bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Filter P2P offers"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            className="flex h-dvh w-full flex-col bg-[var(--p2p-surface-solid)] text-[var(--p2p-ink)] sm:max-w-md sm:border-l sm:border-[var(--p2p-border)]"
          >
            {/* Header */}
            <header className="flex shrink-0 items-center justify-between border-b border-[var(--p2p-border)] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Back"
                  className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--p2p-ink)] hover:bg-[var(--p2p-input-bg)]"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <h2 className="text-lg font-extrabold">Filter</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="hidden size-8 items-center justify-center rounded-lg text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)] sm:inline-flex"
              >
                <X className="size-4" />
              </button>
            </header>

            {/* Scrollable Filter Sections (SS 4, 5, 6) */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
              {/* Save filter */}
              <div className="border-b border-[var(--p2p-border)] pb-3">
                <ToggleSwitch
                  label="Save filter for next use"
                  checked={draft.saveForNextUse}
                  onChange={(v) => setDraft((s) => ({ ...s, saveForNextUse: v }))}
                />
              </div>

              {/* Ad Type Toggles (SS 4) */}
              <div className="border-b border-[var(--p2p-border)] pb-3">
                <h3 className="mb-1 text-sm font-extrabold text-[var(--p2p-ink)]">Ad Type</h3>
                <ToggleSwitch
                  label="Tradable Ads Only"
                  hint="Within your tier cap & trade history requirements"
                  checked={draft.tradableOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, tradableOnly: v }))}
                />
                <ToggleSwitch
                  label="Verified Merchant Ads only"
                  hint="100+ USDC security margin locked on Arc"
                  checked={draft.merchantsOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, merchantsOnly: v }))}
                />
                <ToggleSwitch
                  label="KYC Verified Advertisers only"
                  checked={draft.kycOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, kycOnly: v, noVerificationOnly: v ? false : s.noVerificationOnly }))}
                />
                <ToggleSwitch
                  label="Ads With No Verification Required"
                  checked={draft.noVerificationOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, noVerificationOnly: v, kycOnly: v ? false : s.kycOnly }))}
                />
                <ToggleSwitch
                  label="Beginner-friendly ads only"
                  hint="0 completed trades required"
                  checked={draft.beginnerFriendlyOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, beginnerFriendlyOnly: v }))}
                />
                <ToggleSwitch
                  label="Advertisers You've Traded With"
                  checked={draft.tradedWithOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, tradedWithOnly: v }))}
                />
                <ToggleSwitch
                  label="Advertisers You Follow"
                  checked={draft.followedOnly}
                  onChange={(v) => setDraft((s) => ({ ...s, followedOnly: v }))}
                />
              </div>

              {/* Amount + Presets (SS 4 & 5) */}
              <div className="border-b border-[var(--p2p-border)] pb-4 space-y-2.5">
                <h3 className="text-sm font-extrabold text-[var(--p2p-ink)]">Amount</h3>
                <div className="p2p-input flex h-11 items-center rounded-xl px-3.5">
                  <input
                    inputMode="decimal"
                    value={draftAmount}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (/^\d*\.?\d{0,2}$/.test(v)) setDraftAmount(v)
                    }}
                    placeholder="Enter total amount"
                    className="p2p-mono w-full bg-transparent text-sm font-bold text-[var(--p2p-ink)] outline-none placeholder:font-sans placeholder:font-normal placeholder:text-[var(--p2p-muted)]"
                  />
                  <span className="text-xs font-bold text-[var(--p2p-ink)]">{country.currency}</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {presets.map((p) => {
                    const active = draftAmount === p.value
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setDraftAmount(active ? '' : p.value)}
                        className={`p2p-mono rounded-lg border py-2 text-xs font-semibold transition-colors ${
                          active
                            ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                            : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                        }`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Payment Time Limit (SS 5) */}
              <div className="border-b border-[var(--p2p-border)] pb-4 space-y-2.5">
                <h3 className="text-sm font-extrabold text-[var(--p2p-ink)]">Payment Time Limit (minutes)</h3>
                <div className="grid grid-cols-5 gap-2">
                  {windows.map((w) => {
                    const active = draft.windowLimitMin === w
                    return (
                      <button
                        key={w ?? 'all'}
                        type="button"
                        onClick={() => setDraft((s) => ({ ...s, windowLimitMin: w }))}
                        className={`p2p-mono rounded-lg border py-2 text-xs font-bold transition-colors ${
                          active
                            ? 'border-[var(--p2p-ink)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]'
                            : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                        }`}
                      >
                        {w === null ? 'All' : w}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Payment Method(s) (SS 5 & 6) */}
              <div className="border-b border-[var(--p2p-border)] pb-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-[var(--p2p-ink)]">Payment Method(s)</h3>
                  <span className="text-xs text-[var(--p2p-muted)]">
                    {draftMethod === null ? 'All' : methods.find((m) => m.bit === draftMethod)?.name ?? 'All'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftMethod(null)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs font-bold transition-colors ${
                      draftMethod === null
                        ? 'border-[var(--p2p-ink)] bg-[var(--p2p-surface)] text-[var(--p2p-ink)]'
                        : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)]'
                    }`}
                  >
                    All
                  </button>
                  {methods.map((m) => {
                    const active = draftMethod === m.bit
                    return (
                      <button
                        key={m.bit}
                        type="button"
                        onClick={() => setDraftMethod(active ? null : m.bit)}
                        className={`truncate rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition-colors ${
                          active
                            ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                            : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                        }`}
                      >
                        {m.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Country / Region (SS 6) */}
              <div className="border-b border-[var(--p2p-border)] pb-4 space-y-2.5">
                <h3 className="text-sm font-extrabold text-[var(--p2p-ink)]">Country / Region</h3>
                <div className="grid grid-cols-2 gap-2">
                  {COUNTRIES.map((c) => {
                    const active = draftCountry === c.code
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          setDraftCountry(c.code)
                          setDraftMethod(null)
                        }}
                        className={`flex items-center gap-2 truncate rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition-colors ${
                          active
                            ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                            : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                        }`}
                      >
                        <CountryFlag code={c.code} size={14} />
                        <span className="truncate">{c.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Sort by (SS 6) */}
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-[var(--p2p-ink)]">Sort by</h3>
                {[
                  { id: 'price' as const, label: 'Price' },
                  { id: 'trades' as const, label: 'Trades' },
                  { id: 'completion' as const, label: 'Completion' },
                ].map((opt) => {
                  const active = draft.sortBy === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraft((s) => ({ ...s, sortBy: opt.id }))}
                      className="flex w-full items-center justify-between py-2 text-sm text-[var(--p2p-ink)]"
                    >
                      <span>{opt.label}</span>
                      <span
                        className={`flex size-5 items-center justify-center rounded-full border-2 ${
                          active ? 'border-[#FF5A00]' : 'border-[var(--p2p-muted)]'
                        }`}
                      >
                        {active && <span className="size-2.5 rounded-full bg-[#FF5A00]" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Sticky Footer: Reset | Confirm */}
            <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] px-4 py-3.5">
              <button
                type="button"
                onClick={handleReset}
                className="h-11 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-sm font-bold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="h-11 rounded-xl bg-[#FF5A00] text-sm font-bold text-white hover:opacity-90"
              >
                Confirm
              </button>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
