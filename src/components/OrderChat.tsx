import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Send,
  ShieldAlert,
  Video,
  X,
  ZoomIn,
} from 'lucide-react'
import { toast } from 'sonner'
import { STATUS, formatDuration, sameAddr, shortAddr } from '@/lib/p2p'
import { BackendApiError, useBackendSession } from '@/lib/api'
import { useChat } from '@/hooks/useChat'
import { useNow } from '@/hooks/useEscrow'
import { traderInitial, traderLabel, useTraderProfiles } from '@/hooks/useSocial'
import {
  fetchOrderEvidenceBlob,
  uploadOrderEvidence,
  validateAndPrepareEvidence,
  type PreparedEvidenceFile,
} from '@/hooks/useVault'

const DISPUTE_EVIDENCE_WINDOW_SEC = 2 * 3600 // 2 hours

function ChatEvidenceAttachment({
  orderId,
  blobId,
  mine,
}: {
  orderId: bigint
  blobId: string
  mine: boolean
}) {
  const [asset, setAsset] = useState<{ url: string; mime: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    fetchOrderEvidenceBlob(orderId, blobId)
      .then((res) => {
        if (cancelled) {
          URL.revokeObjectURL(res.objectUrl)
          return
        }
        createdUrl = res.objectUrl
        setAsset({ url: res.objectUrl, mime: res.mimeType })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [orderId, blobId])

  if (failed) {
    return (
      <div className="mt-1.5 rounded-lg border border-white/20 bg-black/20 px-2.5 py-1.5 text-[11px] opacity-80">
        Encrypted attachment unavailable
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-black/15 px-2.5 py-1.5 text-[11px]">
        <Loader2 className="size-3.5 animate-spin" /> Decrypting attachment...
      </div>
    )
  }

  if (asset.mime === 'application/pdf') {
    return (
      <a
        href={asset.url}
        download={`evidence-${blobId.slice(0, 8)}.pdf`}
        className={`mt-1.5 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
          mine
            ? 'border-white/30 bg-white/15 text-white hover:bg-white/25'
            : 'border-[var(--p2p-border-active)] bg-[var(--p2p-surface)] text-[var(--p2p-accent-ink)]'
        }`}
      >
        <FileText className="size-4 shrink-0" />
        <span>Download Encrypted PDF Receipt</span>
      </a>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomOpen(true)}
        className="group relative mt-1.5 block overflow-hidden rounded-lg border border-black/15 bg-black/20 text-left"
      >
        <img
          src={asset.url}
          alt="Encrypted payment evidence"
          className="max-h-52 w-auto max-w-full object-contain transition-transform group-hover:scale-[1.02]"
        />
        <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="size-3" /> View
        </span>
      </button>

      {zoomOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
            onClick={() => setZoomOpen(false)}
          >
            <button
              type="button"
              aria-label="Close image preview"
              onClick={() => setZoomOpen(false)}
              className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X className="size-5" />
            </button>
            <img
              src={asset.url}
              alt="Encrypted payment evidence full view"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88dvh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </>
  )
}

export function OrderChat({
  orderId,
  buyer,
  seller,
  canPost,
  orderStatus,
  disputedAt,
  amountText,
  onBackToOrder,
}: {
  orderId: bigint
  buyer: string
  seller: string
  canPost: boolean
  orderStatus?: number
  disputedAt?: bigint
  amountText?: string
  onBackToOrder?: () => void
}) {
  const { address } = useAccount()
  const session = useBackendSession()
  const now = useNow()
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<PreparedEvidenceFile | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  const isParty = sameAddr(address, buyer) || sameAddr(address, seller)
  const isDisputed = orderStatus === STATUS.DISPUTED || (disputedAt !== undefined && disputedAt > 0n)
  const disputeProofLeft =
    disputedAt && disputedAt > 0n ? Math.max(0, Number(disputedAt) + DISPUTE_EVIDENCE_WINDOW_SEC - now) : 0

  // Encrypted backend chat — active while order is live
  const isLive =
    orderStatus !== STATUS.COMPLETED &&
    orderStatus !== STATUS.CANCELLED &&
    orderStatus !== STATUS.RESOLVED_BUYER &&
    orderStatus !== STATUS.RESOLVED_SELLER &&
    orderStatus !== STATUS.SETTLED
  const { messages: encMessages, isLoading, send: sendEnc, sending } = useChat(
    session ? orderId : null,
    isLive,
  )

  const isBusy = sending || uploadingFile
  const useEncrypted = session !== null
  const MAX_MSG_BYTES = 4_096
  const bytes = new TextEncoder().encode(text).length

  const counterparty = sameAddr(address, buyer)
    ? seller
    : sameAddr(address, seller)
      ? buyer
      : buyer

  const profiles = useTraderProfiles([buyer, seller])
  const cpProfile = profiles.get(counterparty.toLowerCase()) ?? null
  const cpDisplay = traderLabel(counterparty, cpProfile)
  const cpInit = traderInitial(counterparty, cpProfile)

  // Auto-scroll message stream inside the chat box when new messages arrive
  useEffect(() => {
    if (encMessages.length !== prevCountRef.current) {
      prevCountRef.current = encMessages.length
      const el = streamRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [encMessages.length])

  // Clean up local preview URL on unmount or attachment clear
  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    }
  }, [attachment])

  const clearAttachment = () => {
    setAttachment(null)
  }

  const attachFile = async (file: File) => {
    if (!isParty) {
      toast.error('Only the buyer or seller can upload encrypted evidence files.')
      return
    }
    try {
      const prepared = await validateAndPrepareEvidence(file)
      setAttachment(prepared)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid file rejected.')
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await attachFile(file)
  }

  const onPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item && item.kind === 'file') {
        const f = item.getAsFile()
        if (f) {
          e.preventDefault()
          await attachFile(f)
          return
        }
      }
    }
  }

  const send = async () => {
    if (!useEncrypted || isBusy) return
    const trimmed = text.trim()
    if (!trimmed && !attachment) return
    if (bytes > MAX_MSG_BYTES) return

    setUploadingFile(true)
    try {
      let evidenceBlobId: string | null = null
      if (attachment) {
        const uploaded = await uploadOrderEvidence(orderId, attachment)
        evidenceBlobId = uploaded.id
      }
      const messageBody =
        trimmed ||
        (attachment?.mimeType === 'application/pdf'
          ? `Attached PDF receipt: ${attachment.name}`
          : `Attached payment screenshot: ${attachment?.name ?? 'image'}`)

      await sendEnc(messageBody, evidenceBlobId)
      setText('')
      setAttachment(null)
    } catch (err) {
      toast.error(
        err instanceof BackendApiError
          ? err.message
          : 'Could not upload or send encrypted attachment. Please try again.',
      )
    } finally {
      setUploadingFile(false)
    }
  }

  const label = (sender: string) =>
    sameAddr(sender, address)
      ? 'You'
      : sameAddr(sender, buyer)
        ? traderLabel(buyer, profiles.get(buyer.toLowerCase()))
        : sameAddr(sender, seller)
          ? traderLabel(seller, profiles.get(seller.toLowerCase()))
          : `Arbiter (${shortAddr(sender)})`

  return (
    <section
      aria-label="Order messages"
      className={`flex flex-col overflow-hidden ${
        onBackToOrder
          ? 'h-dvh bg-[var(--p2p-surface-solid)] backdrop-blur-2xl'
          : 'p2p-card h-[580px] max-h-[calc(100dvh-150px)] rounded-xl'
      }`}
    >
      {/* Chat Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          {onBackToOrder && (
            <button
              type="button"
              onClick={onBackToOrder}
              className="mr-1 inline-flex items-center gap-1 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] px-2.5 py-1.5 text-xs font-bold text-[var(--p2p-ink)]"
            >
              <ArrowLeft className="size-3.5" /> Order
            </button>
          )}
          <span className="p2p-mono flex size-8 items-center justify-center rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-tint)] text-xs font-bold text-[#FF5A00]">
            {cpInit}
          </span>
          <div>
            <p className="flex items-center gap-2 text-xs font-bold text-[var(--p2p-ink)]">
              <span>{cpDisplay}</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#FF5A00]">
                <span className="size-1.5 rounded-full bg-[#FF5A00]" /> Live
              </span>
            </p>
            <p className="text-[11px] text-[var(--p2p-muted)]">Order #{orderId.toString()} Chat</p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-surface)] px-2 py-1 text-[10px] font-bold text-[var(--p2p-accent-ink)]">
          <Lock className="size-3" /> {useEncrypted ? 'AES-256 Encrypted' : 'Sign in to unlock'}
        </span>
      </div>

      {/* Top Dispute Opened Banner (shown immediately at the top when disputed) */}
      {isDisputed && (
        <div className="mx-3 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--p2p-danger-border)] bg-[var(--p2p-danger-bg)] px-3 py-2 text-xs font-bold text-[var(--p2p-danger-ink)]">
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert className="size-4 shrink-0" />
            Dispute Opened — Submit Proof Within 2 Hours
          </span>
          {orderStatus === STATUS.DISPUTED && disputedAt !== undefined && disputedAt > 0n && (
            <span className="p2p-mono inline-flex items-center gap-1 rounded bg-[var(--p2p-surface-solid)] px-2 py-0.5 text-[11px] text-[var(--p2p-danger-ink)]">
              <Clock className="size-3" />
              {disputeProofLeft > 0 ? `${formatDuration(disputeProofLeft)} left` : '2h window elapsed'}
            </span>
          )}
        </div>
      )}

      {/* Anti-Scam & Name-Mismatch Liability Pinned Banner */}
      <div
        className="mx-3 mt-2.5 flex shrink-0 items-start gap-2 rounded-lg border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] px-3 py-2 text-xs text-[var(--p2p-ink)]"
        style={{ borderLeft: '3px solid #FF5A00' }}
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#FF5A00]" />
        <p className="text-[11px] leading-relaxed">
          <strong className="text-[#FF5A00]">Name Mismatch Warning:</strong> Do <strong>NOT</strong> transfer fiat or
          release USDC if the sender/recipient account name mismatches (no third-party payments). If you still proceed,{' '}
          <strong>OnPeer is not responsible or liable</strong>.
        </p>
      </div>

      {/* Scrollable Message Stream */}
      <div ref={streamRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        <div className="text-center">
          <span className="p2p-mono inline-block rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-1 text-[11px] text-[var(--p2p-muted)]">
            Order #{orderId.toString()} created{amountText ? ` • ${amountText} USDC locked in Arc escrow` : ''}
          </span>
        </div>

        {/* Automatic Official Anti-Triangulation & Name-Mismatch System Message */}
        <div className="rounded-xl border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] p-3 text-xs leading-relaxed text-[var(--p2p-ink)]">
          <div className="flex items-center gap-1.5 font-bold text-[#FF5A00]">
            <ShieldAlert className="size-4 shrink-0" />
            <span>OnPeer System • Mandatory Name-Match &amp; Anti-Scam Policy</span>
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-[var(--p2p-ink)]">
            <li>
              <strong>Buyers:</strong> Send payment strictly from your own personal account. If the seller&apos;s
              account name mismatches, <strong>do NOT transfer</strong>.
            </li>
            <li>
              <strong>Sellers:</strong> Always verify inside your actual banking/mobile app (never trust SMS or chat
              screenshots). If money arrives from a third-party or <strong>mismatched name</strong>,{' '}
              <strong>do NOT release USDC</strong> — open a dispute immediately.
            </li>
            <li className="font-semibold text-[#FF5A00]">
              Liability Notice: If you transfer funds or release USDC despite a name mismatch or third-party payment,
              you act entirely at your own risk and OnPeer will not be responsible or liable for any loss, chargeback,
              or bank freeze.
            </li>
          </ul>
        </div>

        {/* Automatic Official Dispute System Message (2-hour deadline + 2-Phone Raw Video Proof Rule) */}
        {isDisputed && (
          <div className="rounded-xl border border-[var(--p2p-warn-border)] bg-[var(--p2p-warn-bg)] p-3 text-xs leading-relaxed text-[var(--p2p-ink)]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--p2p-warn-ink)]">
              <Video className="size-4 shrink-0" />
              <span>OnPeer System • Mandatory Dispute Evidence (2-Hour Window)</span>
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-[var(--p2p-ink)]">
              Dispute opened! Both Buyer and Seller have <strong>2 hours</strong> to prove their claim with genuine
              payment / banking evidence for the arbiter.
            </p>
            <div className="mt-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface-solid)] p-2.5 text-[11px] text-[var(--p2p-ink)]">
              <strong className="block text-[var(--p2p-accent-ink)]">2-Phone Raw Video Proof Instruction:</strong>
              Record a video using your phone’s back camera while your bank account is open in the app on 2nd Phone.
              Make sure you start by showing your phone’s home screen, then open your banking app and show your
              transactions. Ensure there are no cuts or edits. The video must be completely raw and unedited.
            </div>
          </div>
        )}

        {!useEncrypted ? (
          <p className="py-6 text-center text-xs text-[var(--p2p-muted)]">
            Sign in with your wallet to unlock free encrypted order chat.
          </p>
        ) : isLoading ? (
          <p className="py-6 text-center text-xs text-[var(--p2p-muted)]">Loading messages...</p>
        ) : encMessages.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--p2p-muted)]">
            No messages yet. Share payment references or screenshots securely below.
          </p>
        ) : (
          encMessages.map((m) => {
            const mine = sameAddr(m.author, address)
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <span className="p2p-mono mb-1 text-[10px] text-[var(--p2p-muted)]">
                  {label(m.author)} · {new Date(m.createdAt).toLocaleTimeString()}
                </span>
                <div
                  className={`max-w-[85%] break-words rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    mine
                      ? 'bg-[#FF5A00] font-medium text-[#FFFFFF]'
                      : 'border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] text-[var(--p2p-ink)]'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  {m.evidenceBlobId && (
                    <ChatEvidenceAttachment orderId={orderId} blobId={m.evidenceBlobId} mine={mine} />
                  )}
                </div>
              </div>
            )
          })
        )}

        {orderStatus === STATUS.PAID && (
          <div className="text-center">
            <span className="p2p-mono inline-block rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3.5 py-1.5 text-[11px] font-semibold text-[var(--p2p-accent-ink)]">
              Buyer marked order as paid — awaiting seller verification
            </span>
          </div>
        )}
      </div>

      {/* Pending Attachment Preview */}
      {attachment && (
        <div className="mx-3 mb-2 flex shrink-0 items-center justify-between gap-2.5 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2.5">
            {attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt="Attachment preview"
                className="size-9 shrink-0 rounded object-cover ring-1 ring-[var(--p2p-border)]"
              />
            ) : (
              <FileText className="size-5 shrink-0 text-[var(--p2p-accent-ink)]" />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold text-[var(--p2p-ink)]">{attachment.name}</p>
              <p className="p2p-mono text-[10px] text-[var(--p2p-ok-ink)]">
                Verified {attachment.mimeType.split('/')[1]?.toUpperCase()} • {(attachment.bytes.byteLength / 1024).toFixed(0)} KB • Ready to encrypt
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearAttachment}
            className="rounded-md p-1 text-[var(--p2p-muted)] hover:bg-[var(--p2p-surface)] hover:text-[var(--p2p-ink)]"
            aria-label="Remove attachment"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {canPost && useEncrypted ? (
        <div className="shrink-0 border-t border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
          <div className="flex items-center gap-2">
            {isParty && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => void onPickFile(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileRef.current?.click()}
                  title="Attach genuine PNG, JPG, WebP screenshot or PDF receipt (encrypted)"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)] transition-colors hover:border-[var(--p2p-border-active)] hover:text-[#FF5A00] disabled:opacity-40"
                >
                  <Paperclip className="size-4" />
                </button>
              </>
            )}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => void onPaste(e)}
              onKeyDown={(e) => e.key === 'Enter' && !isBusy && bytes <= MAX_MSG_BYTES && void send()}
              placeholder={isParty ? 'Message, reference, or paste screenshot...' : 'Write arbiter message...'}
              aria-label="Message"
              className="p2p-input h-10 flex-1 rounded-lg px-3 text-xs"
            />
            <button
              type="button"
              aria-label="Send message"
              disabled={(!text.trim() && !attachment) || bytes > MAX_MSG_BYTES || isBusy}
              onClick={() => void send()}
              className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--p2p-muted)]">
            <span>End-to-vault AES-256-GCM encrypted • Fake/renamed images auto-rejected</span>
            <span className={`p2p-mono ${bytes > MAX_MSG_BYTES ? 'font-bold text-[#FF5A00]' : ''}`}>
              {bytes}/{MAX_MSG_BYTES}B
            </span>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-2.5 text-center text-xs text-[var(--p2p-muted)]">
          {!useEncrypted ? 'Sign in with your wallet to unlock free encrypted chat.' : 'Chat closed for this order state.'}
        </div>
      )}
    </section>
  )
}
