import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, FileText, Info, Loader2, Paperclip, Shield, Trash2, X } from 'lucide-react'
import { Button, inputClass } from '@/components/ui'
import { AccountSetup } from '@/components/AccountSetup'
import { BackendApiError, useBackendSession } from '@/lib/api'
import { formatScopedOrderLabel } from '@/lib/p2p'
import { useFileDispute } from '@/hooks/useDispute'
import { uploadOrderEvidence, validateAndPrepareEvidence } from '@/hooks/useVault'

const MAX_STATEMENT_BYTES = 8_192

const REASON_OPTIONS = [
  { value: 'payment_not_received', label: 'Payment not received' },
  { value: 'wrong_amount', label: 'Wrong amount sent' },
  { value: 'wrong_account', label: 'Wrong account / recipient' },
  { value: 'fraud', label: 'Suspected fraud' },
  { value: 'other', label: 'Other' },
] as const

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength
}

export function DisputeFileSheet({
  orderId,
  open,
  mode = 'evidence',
  openingOnchain = false,
  onOpenOnchainDispute,
  onClose,
  onFiled,
}: {
  orderId: bigint
  open: boolean
  mode?: 'open' | 'evidence'
  openingOnchain?: boolean
  onOpenOnchainDispute?: () => Promise<unknown>
  onClose: () => void
  onFiled?: () => void
}) {
  const session = useBackendSession()
  const { file, isPending, error } = useFileDispute(orderId)
  const [reasonCode, setReasonCode] = useState('')
  const [statement, setStatement] = useState('')
  const [uploadedEvidence, setUploadedEvidence] = useState<Array<{ id: string; name: string }>>([])
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  const statementBytes = byteLength(statement)
  const bytesLeft = MAX_STATEMENT_BYTES - statementBytes
  const tooLong = bytesLeft < 0

  const evidenceBlobIds = uploadedEvidence.map((e) => e.id)

  const handlePickEvidence = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    if (uploadedEvidence.length + files.length > 5) {
      toast.error('You can attach up to 5 encrypted evidence files per dispute statement.')
      return
    }
    setUploadingEvidence(true)
    try {
      for (const f of files) {
        const prepared = await validateAndPrepareEvidence(f)
        if (prepared.previewUrl) URL.revokeObjectURL(prepared.previewUrl)
        const res = await uploadOrderEvidence(orderId, prepared)
        setUploadedEvidence((prev) => [...prev, { id: res.id, name: prepared.name }])
      }
      toast.success('Evidence encrypted and attached.')
    } catch (err) {
      toast.error(
        err instanceof BackendApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to encrypt & upload evidence.',
      )
    } finally {
      setUploadingEvidence(false)
    }
  }

  const handleSubmit = async (triggerOnchain: boolean) => {
    if (!reasonCode) {
      toast.error('Select a reason.')
      return
    }
    if (!statement.trim()) {
      toast.error('Describe what happened before submitting.')
      return
    }
    if (tooLong) {
      toast.error('Statement exceeds 8 KB. Please shorten it.')
      return
    }
    try {
      await file({ reasonCode, statement: statement.trim(), evidenceBlobIds })
      if (triggerOnchain && onOpenOnchainDispute) {
        toast.success('Appeal details saved. Please confirm the onchain transaction in your wallet.')
        await onOpenOnchainDispute()
      } else {
        toast.success(
          mode === 'open'
            ? 'Appeal sent to the arbiter queue.'
            : 'Appeal evidence submitted successfully.',
        )
      }
      onFiled?.()
      onClose()
    } catch {
      // error shown via `error` state from hook
    }
  }

  return (
    /* backdrop */
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        className="glass w-full max-w-lg rounded-t-3xl p-6 sm:rounded-3xl"
        style={{ maxHeight: '90dvh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}
            >
              <Shield className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">
                {mode === 'open' ? 'Open Appeal' : 'Submit Appeal Evidence'}
              </h2>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Order {formatScopedOrderLabel(orderId)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 transition-colors hover:bg-[var(--fill-2)]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Auth gate */}
        {!session ? (
          <div className="mt-4">
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
              Sign in to submit your dispute statement.
            </p>
            <AccountSetup />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* Info banner */}
            <div
              className="flex gap-2 rounded-xl p-3 text-xs"
              style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}
            >
              <Info className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <p>
                Your statement is encrypted at rest in the OnPeer Vault. Your counterparty can only see it once an
                arbiter takes the case onchain. Arbiters can triage statements once an order is disputed or 15+ minutes
                after payment. Never include passwords or seed phrases.
              </p>
            </div>

            {/* Reason code */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Reason
              </label>
              <select
                className={inputClass}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
              >
                <option value="">Select a reason…</option>
                {REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Statement */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                  Statement
                </label>
                <span
                  className="text-xs tabular-nums"
                  style={{ color: tooLong ? 'var(--danger)' : 'var(--subtle)' }}
                >
                  {bytesLeft < 0 ? '-' : ''}{Math.abs(bytesLeft)} B left
                </span>
              </div>
              <textarea
                className={inputClass}
                rows={6}
                placeholder="Describe what happened in detail. Include relevant dates, amounts, and any transfer reference numbers."
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                style={{ resize: 'vertical', fontFamily: 'inherit', borderColor: tooLong ? 'var(--danger)' : undefined }}
              />
            </div>

            {/* Encrypted Evidence Uploader (L-01b: replaces manual UUID input) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                  Encrypted evidence <span style={{ color: 'var(--muted)' }}>(optional, up to 5 files)</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => void handlePickEvidence(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingEvidence || uploadedEvidence.length >= 5}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
                  style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                >
                  {uploadingEvidence ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                  {uploadingEvidence ? 'Encrypting…' : 'Attach screenshot / PDF'}
                </button>
              </div>
              {uploadedEvidence.length > 0 && (
                <ul className="space-y-1.5">
                  {uploadedEvidence.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs"
                      style={{ background: 'var(--fill-2)' }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Check className="size-3.5 shrink-0" style={{ color: 'var(--success)' }} />
                        <FileText className="size-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                        <span className="truncate font-medium">{ev.name}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${ev.name}`}
                        onClick={() => setUploadedEvidence((prev) => prev.filter((x) => x.id !== ev.id))}
                        className="rounded p-1 hover:opacity-80"
                        style={{ color: 'var(--muted)' }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* API error */}
            {error && (
              <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="space-y-2.5 pt-1">
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isPending || openingOnchain}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={!reasonCode || !statement.trim() || tooLong || isPending || openingOnchain || uploadingEvidence}
                  loading={isPending || openingOnchain}
                  onClick={() => void handleSubmit(mode === 'open' && Boolean(onOpenOnchainDispute))}
                >
                  {mode === 'open' ? 'Submit Appeal' : 'Submit Evidence'}
                </Button>
              </div>
              {mode === 'open' && onOpenOnchainDispute && (
                <button
                  type="button"
                  disabled={!reasonCode || !statement.trim() || tooLong || isPending || openingOnchain || uploadingEvidence}
                  onClick={() => void handleSubmit(false)}
                  className="block w-full text-center text-[11px] font-medium underline opacity-75 transition-opacity hover:opacity-100 disabled:opacity-40"
                  style={{ color: 'var(--muted)' }}
                >
                  No gas in wallet? Send appeal to Arbiter without onchain tx
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
