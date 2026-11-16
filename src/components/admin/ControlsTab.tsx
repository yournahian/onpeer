import { useState } from 'react'
import { PauseCircle, PlayCircle, UserCog } from 'lucide-react'
import { useReadContracts } from 'wagmi'
import { isAddress, type Address } from 'viem'
import { p2pEscrowAbi } from '@/abi/p2pEscrow'
import { CHAIN_ID, COUNTRIES, ESCROW_ADDRESS, currencyToHex } from '@/lib/p2p'
import { usePaused } from '@/hooks/useEscrow'
import { useTx } from '@/hooks/useTx'
import { Button, inputClass } from '@/components/ui'
import { CountryFlag } from '@/components/logos'

const base = { address: ESCROW_ADDRESS, abi: p2pEscrowAbi, chainId: CHAIN_ID } as const

function Panel({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-4 sm:p-5">
      <h3 className="display text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>{body}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function ControlsTab({ isOwner }: { isOwner: boolean }) {
  const paused = usePaused()
  const { run, writeContractAsync, pendingKey } = useTx()
  const [newArbiter, setNewArbiter] = useState('')
  const valid = isAddress(newArbiter.trim())

  const supported = useReadContracts({
    contracts: COUNTRIES.map((c) => ({ ...base, functionName: 'supportedCurrency' as const, args: [currencyToHex(c.currency)] as const })),
    query: { enabled: !!ESCROW_ADDRESS, refetchInterval: 20_000 },
  })

  if (!isOwner) {
    return (
      <div className="glass rounded-3xl p-6 text-sm" style={{ color: 'var(--muted)' }}>
        Marketplace controls are limited to the contract owner. Your wallet can rule on disputes and restrict accounts.
      </div>
    )
  }

  const send = (key: string, label: string, fn: 'pause' | 'unpause') =>
    run(key, label, () => writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: fn }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title={paused ? 'Marketplace is paused' : 'Marketplace is live'}
        body="Pausing stops new ads and new orders. Existing orders, releases, disputes, cancels and withdrawals keep working."
      >
        <Button variant={paused ? 'buy' : 'danger'} loading={pendingKey === 'pause'} onClick={() => void send('pause', paused ? 'Resume marketplace' : 'Pause marketplace', paused ? 'unpause' : 'pause')}>
          {paused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
          {paused ? 'Resume marketplace' : 'Pause marketplace'}
        </Button>
      </Panel>

      <Panel title="Dispute arbiter" body="Replace the wallet that rules on disputes. It also takes over any dispute that is still open, so only use an address you trust.">
        <input
          value={newArbiter}
          onChange={(e) => setNewArbiter(e.target.value)}
          placeholder="New arbiter address (0x...)"
          spellCheck={false}
          className={`${inputClass} mono text-sm`}
          aria-label="New arbiter address"
        />
        <Button
          className="mt-3"
          disabled={!valid}
          loading={pendingKey === 'arbiter'}
          onClick={() =>
            void run('arbiter', 'Change arbiter', () =>
              writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setArbiter', args: [newArbiter.trim() as Address] }),
            )
          }
        >
          <UserCog className="size-4" /> Set arbiter
        </Button>
      </Panel>

      <div className="lg:col-span-2">
        <Panel title="Supported currencies" body="Switch a local currency off to stop new ads in it. Existing orders are not affected.">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COUNTRIES.map((c, i) => {
              const on = supported.data?.[i]?.status === 'success' ? supported.data[i].result === true : undefined
              const key = `cur-${c.currency}`
              return (
                <li key={c.code}>
                  <button
                    disabled={on === undefined || pendingKey === key}
                    onClick={() =>
                      void run(key, `${on ? 'Disable' : 'Enable'} ${c.currency}`, () =>
                        writeContractAsync({ ...base, address: ESCROW_ADDRESS!, functionName: 'setCurrency', args: [currencyToHex(c.currency), !on] }),
                      )
                    }
                    aria-pressed={on}
                    className="inner flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold disabled:opacity-50"
                  >
                    <CountryFlag code={c.code} size={22} />
                    <span className="flex-1">{c.currency}</span>
                    <span className="text-xs" style={{ color: on ? 'var(--success)' : 'var(--subtle)' }}>{on === undefined ? '...' : on ? 'On' : 'Off'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
