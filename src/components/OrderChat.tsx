import { useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { keccak256 } from 'viem'
import { AlertTriangle, ArrowLeft, Lock, Paperclip, Send } from 'lucide-react'
import { MESSAGE_MAX_BYTES, STATUS, sameAddr, shortAddr } from '@/lib/p2p'
import { useBackendSession } from '@/lib/api'
import { useChat } from '@/hooks/useChat'

export function OrderChat({
  orderId,
  buyer,
  seller,
  canPost,
  orderStatus,
  amountText,
  onBackToOrder,
}: {
  orderId: bigint
  buyer: string
  seller: string
  canPost: boolean
  orderStatus?: number
  amountText?: string
  onBackToOrder?: () => void
}) {
  const { address } = useAccount()
  const session = useBackendSession()
  const [text, setText] = useState('')
  const [attachedProof, setAttachedProof] = useState<{ name: string; hash: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Encrypted backend chat — only active when signed in and order is live
  const isLive = orderStatus !== STATUS.COMPLETED && orderStatus !== STATUS.CANCELLED
  const { messages: encMessages, isLoading, send: sendEnc, sending: isBusy } = useChat(
    session ? orderId : null,
    isLive,
  )

  const useEncrypted = session !== null

  const bytes = new TextEncoder().encode(text).length
  const counterparty = sameAddr(address, buyer)
    ? seller
    : sameAddr(address, seller)
      ? buyer
      : buyer

  const MAX_MSG_BYTES = 4_096

  const send = async () => {
    const body = text.trim()
    if (!body || !useEncrypted || bytes > MAX_MSG_BYTES) return
    await sendEnc(body)
    setText('')
    setAttachedProof(null)
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const buf = await file.arrayBuffer()
    const hash = keccak256(new Uint8Array(buf))
    const shortName = file.name.slice(0, 24)
    const stamp = `[Proof keccak256: ${hash.slice(0, 14)}...${hash.slice(-8)} • ${shortName}]`
    setAttachedProof({ name: shortName, hash })
    setText((prev) => (prev.trim() ? `${prev.trim()} ${stamp}` : stamp).slice(0, MESSAGE_MAX_BYTES))
  }

  const label = (sender: string) =>
    sameAddr(sender, address)
      ? 'You'
      : sameAddr(sender, buyer)
        ? 'Buyer'
        : sameAddr(sender, seller)
          ? 'Seller'
          : `Arbiter (${shortAddr(sender)})`

  return (
    <section
      aria-label="Order messages"
      className={`flex flex-col overflow-hidden ${
        onBackToOrder ? 'h-dvh bg-[var(--p2p-surface-solid)] backdrop-blur-2xl' : 'p2p-card h-full rounded-xl'
      }`}
    >
      {/* Chat Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-3">
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
            {counterparty.slice(2, 4).toUpperCase()}
          </span>
          <div>
            <p className="p2p-mono flex items-center gap-2 text-xs font-bold text-[var(--p2p-ink)]">
              {shortAddr(counterparty)}
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#FF5A00]">
                <span className="size-1.5 rounded-full bg-[#FF5A00]" /> Live
              </span>
            </p>
            <p className="text-[11px] text-[var(--p2p-muted)]">Order #{orderId.toString()} Chat</p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 rounded border border-[var(--p2p-border-active)] bg-[var(--p2p-surface)] px-2 py-1 text-[10px] font-bold text-[var(--p2p-accent-ink)]">
          <Lock className="size-3" /> {useEncrypted ? 'Encrypted Chat' : 'Sign in to unlock'}
        </span>
      </div>

      {/* Anti-Scam Pinned Banner */}
      <div
        className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-2.5 text-xs text-[var(--p2p-ink)]"
        style={{ borderLeft: '3px solid #FF5A00' }}
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--p2p-accent-ink)]" />
        <p className="leading-relaxed">
          <strong className="text-[var(--p2p-accent-ink)]">Security Notice:</strong> Never trust SMS payment alerts. Always verify inside your actual banking or mobile payment app before releasing USDC.
        </p>
      </div>

      {/* Message Stream */}
      <div className="min-h-[260px] flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="text-center">
          <span className="p2p-mono inline-block rounded-full border border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-3 py-1 text-[11px] text-[var(--p2p-muted)]">
            Order #{orderId.toString()} created{amountText ? ` • ${amountText} USDC locked in Arc escrow` : ''}
          </span>
        </div>

        {!useEncrypted ? (
          <p className="py-6 text-center text-xs text-[var(--p2p-muted)]">
            Sign in with your wallet to unlock free encrypted order chat.
          </p>
        ) : isLoading ? (
          <p className="py-6 text-center text-xs text-[var(--p2p-muted)]">Loading messages...</p>
        ) : encMessages.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--p2p-muted)]">
            No messages yet. Share payment references securely below.
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
                  {m.body}
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
        {orderStatus === STATUS.DISPUTED && (
          <div className="text-center">
            <span className="p2p-mono inline-block rounded-full border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3.5 py-1.5 text-[11px] font-bold text-[var(--p2p-accent-ink)]">
              Dispute opened — arbiter evidence review active
            </span>
          </div>
        )}
      </div>

      {attachedProof && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--p2p-border-active)] bg-[var(--p2p-input-bg)] px-3 py-1.5 text-[11px]">
          <span className="p2p-mono truncate text-[#FF5A00]">
            keccak256: {attachedProof.hash.slice(0, 18)}... ({attachedProof.name})
          </span>
          <button
            type="button"
            onClick={() => setAttachedProof(null)}
            className="shrink-0 text-[var(--p2p-muted)] hover:text-[var(--p2p-ink)]"
          >
            Clear
          </button>
        </div>
      )}

      {canPost && useEncrypted ? (
        <div className="border-t border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] p-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => void onPickFile(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Generate keccak256 proof hash from payment screenshot"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--p2p-border)] bg-[var(--p2p-surface)] text-[var(--p2p-muted)] transition-colors hover:border-[var(--p2p-border-active)] hover:text-[#FF5A00]"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && bytes <= MAX_MSG_BYTES && void send()}
              placeholder="Write message or payment reference..."
              aria-label="Message"
              className="p2p-input h-10 flex-1 rounded-lg px-3 text-xs"
            />
            <button
              type="button"
              aria-label="Send message"
              disabled={!text.trim() || bytes > MAX_MSG_BYTES || isBusy}
              onClick={() => void send()}
              className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#FF5A00] px-3.5 text-xs font-bold text-[#FFFFFF] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="size-3.5" />
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--p2p-muted)]">
            <span>Free encrypted offchain chat • attach receipt to include keccak256 proof</span>
            <span className={`p2p-mono ${bytes > MAX_MSG_BYTES ? 'text-[#FF5A00] font-bold' : ''}`}>
              {bytes}/{MAX_MSG_BYTES}B
            </span>
          </div>
        </div>
      ) : (
        <div className="border-t border-[var(--p2p-border)] bg-[var(--p2p-input-bg)] px-4 py-2.5 text-center text-xs text-[var(--p2p-muted)]">
          {!useEncrypted ? 'Sign in with your wallet to unlock free encrypted chat.' : 'Chat closed for this order state.'}
        </div>
      )}
    </section>
  )
}
