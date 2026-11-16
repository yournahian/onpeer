import { COUNTRIES, methodsForCountry } from '@/lib/p2p'
import { CountryFlag, MethodLogo } from '@/components/logos'
import { Reveal } from '@/components/fx/Reveal'
import { AppLink } from '@/components/AppLink'

export function Countries() {
  return (
    <section className="mt-24" aria-labelledby="countries-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>Made for the region</p>
        <h2 id="countries-title" className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">
          Eight currencies, the payment apps you already use
        </h2>
      </Reveal>
      <ul className="mt-10 grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4">
        {COUNTRIES.map((c, i) => {
          const methods = methodsForCountry(c.code).filter((m) => m.name !== 'Bank transfer').slice(0, 4)
          return (
            <li key={c.code}>
              <Reveal delay={(i % 4) * 0.07} className="h-full">
                <AppLink to="/p2p" className="glass lift group flex h-full flex-col rounded-3xl p-5">
                  <div className="flex items-center justify-between">
                    <CountryFlag code={c.code} size={44} />
                    <span className="display text-3xl font-bold transition-transform duration-500 group-hover:scale-110" style={{ color: 'var(--accent)' }}>
                      {c.symbol}
                    </span>
                  </div>
                  <p className="display mt-4 text-lg font-bold">{c.name}</p>
                  <p className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>{c.currency}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {methods.map((m) => (
                      <MethodLogo key={m.bit} name={m.name} size={28} />
                    ))}
                  </div>
                </AppLink>
              </Reveal>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
