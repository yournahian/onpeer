import { COUNTRIES, methodsForCountry } from '@/lib/p2p'
import { CountryFlag, MethodLogo } from '@/components/logos'
import { Reveal } from '@/components/fx/Reveal'
import { AppLink } from '@/components/AppLink'

export function Countries() {
  const row = [...COUNTRIES, ...COUNTRIES]
  return (
    <section className="mt-24" aria-labelledby="countries-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>Made for the region</p>
        <h2 id="countries-title" className="display mt-2 text-balance text-4xl font-bold sm:text-5xl" style={{ color: 'var(--accent)' }}>
          Eight currencies, the payment apps you already use
        </h2>
      </Reveal>
      <div
        className="marquee-wrap relative -my-10 mt-10 overflow-x-clip py-12"
        style={{
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
        }}
      >
        <ul className="marquee">
          {row.map((c, idx) => {
            const methods = methodsForCountry(c.code).filter((m) => m.name !== 'Bank transfer').slice(0, 4)
            return (
              <li key={`${c.code}-${idx}`} className="mr-3.5 w-[235px] shrink-0 sm:w-[255px]" aria-hidden={idx >= COUNTRIES.length}>
                <AppLink
                  to="/p2p"
                  tabIndex={idx >= COUNTRIES.length ? -1 : undefined}
                  className="glass lift group flex h-full flex-col rounded-2xl p-4"
                >
                  <div className="flex items-center justify-between">
                    <CountryFlag code={c.code} size={36} />
                    <span className="display text-2xl font-bold transition-transform duration-500 group-hover:scale-110" style={{ color: 'var(--accent)' }}>
                      {c.symbol}
                    </span>
                  </div>
                  <p className="display mt-2.5 text-base font-bold">{c.name}</p>
                  <p className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>{c.currency}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {methods.map((m) => (
                      <MethodLogo key={m.bit} name={m.name} size={24} />
                    ))}
                  </div>
                </AppLink>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
