import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Send } from 'lucide-react'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, ESCROW_ADDRESS, MESSAGE_MAX_BYTES, sameAddr, shortAddr } from '@/lib/p2p'
import { useOrderMessages } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button, inputClass } from '@/components/ui'

export function OrderChat({
  orderId,
  buyer,
  seller,
  canPost,
}: {
  orderId: bigint
  buyer: string
  seller: string
  canPost: boolean
}) {
  const { address } = useAccount()
  const { data: messages, isLoading } = useOrderMessages(orderId)
  const { run, writeContractAsync, pendingKey } = useTx()
  const [text, setText] = useState('')
  const bytes = new TextEncoder().encode(text).length

  const send = async () => {
    const body = text.trim()
    if (!body || !ESCROW_ADDRESS) return
    const ok = await run('message', 'Send message', () =>
      writeContractAsync({
        address: ESCROW_ADDRESS!,
        abi: p2pEscrowAbi,
        functionName: 'postMessage',
        args: [orderId, body],
        chainId: CHAIN_ID,
      }),
    )
    if (ok) setText('')
  }

  const label = (sender: string) =>
    sameAddr(sender, address)
      ? 'You'
      : sameAddr(sender, buyer)
        ? 'Buyer'
        : sameAddr(sender, seller)
          ? 'Seller'
          : `Arbiter ${shortAddr(sender)}`

  return (
    <section className="inner rounded-2xl p-4" aria-label="Order messages">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
        Messages and evidence
      </p>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            Loading...
          </p>
        ) : !messages || messages.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            No messages yet. Use this to share payment references or links to proof. Messages are public onchain.
          </p>
        ) : (
          messages.map((m) => (
            <div key={`${m.block}-${m.index}`} className="text-sm">
              <span
                className="mr-2 text-xs font-semibold"
                style={{ color: sameAddr(m.sender, address) ? 'var(--accent)' : 'var(--muted)' }}
              >
                {label(m.sender)}
              </span>
              <span className="break-words">{m.text}</span>
            </div>
          ))
        )}
      </div>
      {canPost && (
        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && bytes <= MESSAGE_MAX_BYTES && void send()}
            placeholder="Write a message"
            aria-label="Message"
            className={inputClass}
          />
          <Button
            aria-label="Send message"
            className="px-3"
            disabled={!text.trim() || bytes > MESSAGE_MAX_BYTES}
            loading={pendingKey === 'message'}
            onClick={() => void send()}
          >
            <Send className="size-4" />
          </Button>
        </div>
      )}
    </section>
  )
}
