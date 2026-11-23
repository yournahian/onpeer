import { useState } from 'react'
import { CheckCircle2, Edit3, Loader2, Star, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import { sameAddr, shortAddr } from '@/lib/p2p'
import { BackendApiError } from '@/lib/api'
import { useOrderFeedback, type PublicTraderSummary, traderLabel } from '@/hooks/useSocial'

const POSITIVE_TAGS = ['Fast release', 'Smooth payment', 'Polite & trustworthy', 'Recommended trader']
const NEGATIVE_TAGS = ['Slow response', 'Delayed payment', 'Unpolite in chat', 'Did not follow terms']

export function OrderFeedbackCard({
  orderId,
  viewer,
  counterparty,
  counterpartyProfile,
}: {
  orderId: bigint
  viewer?: string
  counterparty: string
  counterpartyProfile?: PublicTraderSummary | null
}) {
  const { items, isLoading, submitFeedback, submitting } = useOrderFeedback(orderId, true)
  const existingMine = items.find((i) => viewer && sameAddr(i.fromWallet, viewer))
  const counterpartyItem = items.find((i) => sameAddr(i.fromWallet, counterparty))

  const [editing, setEditing] = useState(false)
  const [positive, setPositive] = useState<boolean>(existingMine?.positive ?? true)
  const [rating, setRating] = useState<number>(existingMine?.rating ?? 5)
  const [comment, setComment] = useState<string>(existingMine?.comment ?? '')
  const [anonymous, setAnonymous] = useState<boolean>(existingMine?.anonymous ?? false)

  const cpName = traderLabel(counterparty, counterpartyProfile)

  const startEdit = () => {
    if (existingMine) {
      setPositive(existingMine.positive)
      setRating(existingMine.rating)
      setComment(existingMine.comment)
      setAnonymous(existingMine.anonymous)
    }
    setEditing(true)
  }

  const handleSelectThumb = (nextPos: boolean) => {
    setPositive(nextPos)
    if (nextPos && rating < 4) setRating(5)
    if (!nextPos && rating > 2) setRating(2)
  }

  const toggleTag = (tag: string) => {
    if (comment.includes(tag)) {
      setComment(
        comment
          .replace(tag, '')
          .replace(/\s*,\s*,/g, ', ')
          .replace(/^[,\s]+|[,\s]+$/g, ''),
      )
    } else {
      const next = comment.trim() ? `${comment.trim()}, ${tag}` : tag
      setComment(next.slice(0, 280))
    }
  }

  const handleSubmit = async () => {
    try {
      await submitFeedback({
        rating,
        positive,
        comment: comment.trim(),
        anonymous,
      })
      setEditing(false)
      toast.success(`Feedback submitted for ${cpName}`)
    } catch (err) {
      toast.error(err instanceof BackendApiError ? err.message : 'Could not submit feedback.')
    }
  }

  if (isLoading && items.length === 0) {
    return <div className="p2p-card h-28 animate-pulse rounded-xl" />
  }

  const showForm = !existingMine || editing
  const quickTags = positive ? POSITIVE_TAGS : NEGATIVE_TAGS

  return (
    <section className="p2p-card rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--p2p-border)] pb-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--p2p-ink)]">
            How was your trading experience with <span className="text-[#FF5A00]">{cpName}</span>?
          </h3>
          <p className="mt-0.5 text-xs text-[var(--p2p-muted)]">
            Leave a rating and feedback to help other P2P traders evaluate counterparties.
          </p>
        </div>

        {existingMine && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--p2p-ink)] hover:border-[#FF5A00]"
          >
            <Edit3 className="size-3.5 text-[#FF5A00]" /> Edit Feedback
          </button>
        )}
      </div>

      {showForm ? (
        <div className="space-y-4">
          {/* Positive / Negative Selector */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => handleSelectThumb(true)}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition-colors ${
                positive
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
              }`}
            >
              <ThumbsUp className="size-4" /> Positive
            </button>
            <button
              type="button"
              onClick={() => handleSelectThumb(false)}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition-colors ${
                !positive
                  ? 'border-red-500 bg-red-500/15 text-red-400'
                  : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
              }`}
            >
              <ThumbsDown className="size-4" /> Negative
            </button>
          </div>

          {/* 1-5 Star Rating */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3.5 py-2.5">
            <span className="text-xs font-semibold text-[var(--p2p-muted)]">Overall Rating</span>
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = star <= rating
                return (
                  <button
                    key={star}
                    type="button"
                    aria-label={`${star} star${star > 1 ? 's' : ''}`}
                    onClick={() => setRating(star)}
                    className="p-0.5 transition-transform hover:scale-110"
                  >
                    <Star
                      className={`size-5 ${
                        active ? 'fill-[#FF5A00] text-[#FF5A00]' : 'text-[var(--p2p-muted)] opacity-50'
                      }`}
                    />
                  </button>
                )
              })}
              <span className="p2p-mono ml-1 text-xs font-bold text-[var(--p2p-ink)]">{rating}/5</span>
            </div>
          </div>

          {/* Quick Tags */}
          <div className="flex flex-wrap gap-1.5">
            {quickTags.map((tag) => {
              const selected = comment.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                    selected
                      ? 'border-[#FF5A00] bg-[var(--p2p-tint)] text-[#FF5A00]'
                      : 'border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]'
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>

          {/* Comment Box */}
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-[var(--p2p-muted)]">
              <span>Comment (Optional)</span>
              <span className="p2p-mono">{comment.length}/280</span>
            </span>
            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 280))}
              placeholder="Share your trading experience (no personal phone/account numbers)..."
              className="p2p-input w-full resize-none rounded-lg px-3 py-2 text-xs text-[var(--p2p-ink)]"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--p2p-muted)]">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="size-4 accent-[#FF5A00]"
              />
              <span>Leave feedback anonymously</span>
            </label>

            <div className="flex items-center gap-2">
              {editing && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setEditing(false)}
                  className="min-h-10 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 text-xs font-semibold text-[var(--p2p-ink)]"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF5A00] px-5 text-xs font-bold text-[#FFFFFF] hover:opacity-90 disabled:opacity-50"
              >
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--p2p-ink)]">
              <CheckCircle2 className="size-4 text-emerald-400" />
              Your Feedback:{' '}
              <span className={existingMine.positive ? 'text-emerald-400' : 'text-red-400'}>
                {existingMine.positive ? 'Positive 👍' : 'Negative 👎'}
              </span>
            </span>
            <span className="inline-flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, idx) => (
                <Star
                  key={idx}
                  className={`size-3.5 ${
                    idx < existingMine.rating ? 'fill-[#FF5A00] text-[#FF5A00]' : 'text-[var(--p2p-muted)] opacity-35'
                  }`}
                />
              ))}
            </span>
          </div>
          {existingMine.comment && <p className="text-xs text-[var(--p2p-ink)]">{existingMine.comment}</p>}
          {existingMine.anonymous && (
            <p className="text-[11px] text-[var(--p2p-muted)]">Posted anonymously</p>
          )}
        </div>
      )}

      {counterpartyItem && (
        <div className="rounded-xl border border-[var(--p2p-border)] bg-[var(--p2p-surface)] p-3.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[var(--p2p-muted)]">
              Counterparty Review ({counterpartyItem.fromDisplayName ?? shortAddr(counterpartyItem.fromWallet)}):{' '}
              <strong className={counterpartyItem.positive ? 'text-emerald-400' : 'text-red-400'}>
                {counterpartyItem.positive ? 'Positive 👍' : 'Negative 👎'}
              </strong>
            </span>
            <span className="inline-flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, idx) => (
                <Star
                  key={idx}
                  className={`size-3.5 ${
                    idx < counterpartyItem.rating
                      ? 'fill-[#FF5A00] text-[#FF5A00]'
                      : 'text-[var(--p2p-muted)] opacity-35'
                  }`}
                />
              ))}
            </span>
          </div>
          {counterpartyItem.comment && <p className="text-xs text-[var(--p2p-ink)]">{counterpartyItem.comment}</p>}
        </div>
      )}
    </section>
  )
}
