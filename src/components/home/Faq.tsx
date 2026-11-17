import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { Reveal } from '@/components/fx/Reveal'

const QUESTIONS = [
  {
    q: 'What is OnPeer?',
    a: 'OnPeer is a place to trade USDC with other people in your own currency. It also has a swap and a bridge, all on Arc.',
  },
  {
    q: 'Is my money safe while I trade?',
    a: 'The seller’s USDC is held by a smart contract from the moment an order opens, and it only moves when the seller releases it or the arbiter rules on a dispute. Fiat payments happen outside the app, so always pay from an account in your own name.',
  },
  {
    q: 'What if the seller does not release my USDC?',
    a: 'After you mark an order as paid you can open a dispute. Both sides post messages as evidence and the arbiter decides where the USDC goes.',
  },
  {
    q: 'Which countries and payment methods are supported?',
    a: 'India, Pakistan, Bangladesh, Sri Lanka, Nepal, Bhutan, Maldives and Afghanistan, with local options such as UPI, IMPS, Raast, JazzCash, Easypaisa, bKash, Nagad, eSewa and LankaQR.',
  },
  {
    q: 'Do I need ETH or another gas token?',
    a: 'No. On Arc, USDC is the gas token, so one USDC balance pays for trades and network fees.',
  },
  {
    q: 'Is this real money?',
    a: 'Not yet. OnPeer runs on Arc Testnet with test funds. Use the Get test USDC button in the Arc Studio sidebar to try it.',
  },
  {
    q: 'What powers the swap and the bridge?',
    a: 'The bridge uses Circle CCTP to burn USDC on one chain and mint it on another. Swaps are routed through a swap provider chosen for each route, and you always see the quote and fees first.',
  },
] as const

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="mt-24 grid gap-10 lg:grid-cols-[360px_1fr]" aria-labelledby="faq-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>FAQ</p>
        <h2 id="faq-title" className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">Good questions</h2>
        <p className="mt-3 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
          Not covered here? Ask the assistant at the bottom right of any page, or email{' '}
          <a href="mailto:support@onpeer.xyz" className="font-semibold underline-offset-4 hover:underline" style={{ color: 'var(--ink)' }}>
            support@onpeer.xyz
          </a>
          .
        </p>
      </Reveal>
      <ul className="space-y-3">
        {QUESTIONS.map((item, i) => {
          const isOpen = open === i
          return (
            <li key={item.q}>
              <Reveal delay={i * 0.04} y={14}>
                <div className="glass overflow-hidden rounded-2xl">
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left text-sm font-semibold sm:text-base"
                  >
                    {item.q}
                    <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 26 }} className="shrink-0" style={{ color: 'var(--accent)' }}>
                      <Plus className="size-5" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-5 text-pretty text-sm" style={{ color: 'var(--muted)' }}>{item.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
