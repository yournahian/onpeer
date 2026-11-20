import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Info, Shield, X } from 'lucide-react'
import { Button, inputClass } from '@/components/ui'
import { AccountSetup } from '@/components/AccountSetup'
import { useBackendSession } from '@/lib/api'
import { useFileDispute } from '@/hooks/useDispute'

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
  onClose,
  onFiled,
}: {
  orderId: bigint
  open: boolean
  onClose: () => void
  onFiled?: () => void
}) {
  const session = useBackendSession()
  const { file, isPending, error } = useFileDispute(orderId)
  const [reasonCode, setReasonCode] = useState('')
  const [statement, setStatement] = useState('')
  const [evidenceBlobId, setEvidenceBlobId] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  const statementBytes = byteLength(statement)
  const bytesLeft = MAX_STATEMENT_BYTES - statementBytes
  const tooLong = bytesLeft < 0

  const evidenceBlobIds = evidenceBlobId.trim()
    ? [evidenceBlobId.trim()]
    : []

  const handleSubmit = async () => {
    if (!reasonCode) {
      toast.error('Select a reason code.')
      return
    }
    if (!statement.trim()) {
      toast.error('Enter your dispute statement.')
      return
    }
    if (tooLong) {
      toast.error('Statement exceeds 8 KB. Please shorten it.')
      return
    }
    try {
      await file({ reasonCode, statement: statement.trim(), evidenceBlobIds })
      toast.success('Dispute statement submitted successfully.')
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
              <h2 className="text-base font-bold">File dispute statement</h2>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Order #{orderId.toString()}
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
                Your statement is encrypted end-to-end. The arbiter can read it only after taking
                the case. The counterparty sees your statement once the arbiter has accepted review.
                Do not include personal contact info or passwords.
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

            {/* Evidence blob ID (optional) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
                Evidence blob ID <span style={{ color: 'var(--muted)' }}>(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <FileText className="size-4 shrink-0" style={{ color: 'var(--muted)' }} />
                <input
                  className={inputClass}
                  placeholder="Vault blob UUID"
                  value={evidenceBlobId}
                  onChange={(e) => setEvidenceBlobId(e.target.value)}
                />
              </div>
            </div>

            {/* API error */}
            {error && (
              <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--fill-2)', color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!reasonCode || !statement.trim() || tooLong || isPending}
                loading={isPending}
                onClick={() => void handleSubmit()}
              >
                Submit statement
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
