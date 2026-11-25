import { COUNTRIES, COUNTRY_PROVIDERS } from '@/lib/p2p'
import { MethodLogo } from '@/components/logos'
import { Reveal } from '@/components/fx/Reveal'
import { AppLink } from '@/components/AppLink'

/**
 * Tailored framing for each flag SVG so iconic national emblems
 * (crescents, Ashoka Chakra, lion, dragon, red disc, Nepal's double pennant)
 * sit in the upper-right focal zone while typography & payment logos stay razor-sharp.
 */
const FLAG_STYLE: Record<
  string,
  {
    bg: string
    objectClass: string
  }
> = {
  IN: {
    bg: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    objectClass: 'object-cover object-center',
  },
  PK: {
    bg: 'linear-gradient(135deg, #063806 0%, #0c590b 100%)',
    objectClass: 'object-cover object-[72%_42%]',
  },
  BD: {
    bg: 'linear-gradient(135deg, #004d38 0%, #006a4e 100%)',
    objectClass: 'object-cover object-[56%_45%]',
  },
  LK: {
    bg: 'linear-gradient(135deg, #5c1319 0%, #8d2029 100%)',
    objectClass: 'object-cover object-[75%_45%]',
  },
  NP: {
    // Nepal's flag is non-rectangular (transparent right side); pair a rich royal-crimson & navy field
    bg: 'linear-gradient(135deg, #0b1536 0%, #7a0916 55%, #000044 100%)',
    objectClass: 'object-contain object-right pr-3 py-2 scale-105',
  },
  BT: {
    bg: 'linear-gradient(135deg, #9a3412 0%, #ff4e12 100%)',
    objectClass: 'object-cover object-center',
  },
  MV: {
    bg: 'linear-gradient(135deg, #7f091f 0%, #00662e 100%)',
    objectClass: 'object-cover object-center',
  },
  AF: {
    bg: 'linear-gradient(135deg, #09090b 0%, #7f1d1d 50%, #064e3b 100%)',
    objectClass: 'object-cover object-center',
  },
}

export function Countries() {
  const row = [...COUNTRIES, ...COUNTRIES]
  return (
    <section className="mt-24" aria-labelledby="countries-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
          Made for the region
        </p>
        <h2
          id="countries-title"
          className="display mt-2 text-balance text-4xl font-bold sm:text-5xl"
          style={{ color: 'var(--accent)' }}
        >
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
            const providers = COUNTRY_PROVIDERS[c.code] ?? []
            const flagCfg = FLAG_STYLE[c.code] ?? {
              bg: '#0f1117',
              objectClass: 'object-cover object-center',
            }

            return (
              <li
                key={`${c.code}-${idx}`}
                className="mr-4 w-[274px] shrink-0 sm:w-[298px]"
                aria-hidden={idx >= COUNTRIES.length}
              >
                <AppLink
                  to={`/p2p?currency=${c.currency}`}
                  tabIndex={idx >= COUNTRIES.length ? -1 : undefined}
                  className="group relative isolate flex h-[224px] flex-col justify-between overflow-hidden rounded-3xl p-5 transition-all duration-500 hover:-translate-y-1.5"
                  style={{
                    background: flagCfg.bg,
                    boxShadow:
                      '0 20px 48px -16px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.16)',
                  }}
                >
                  {/* Layer 1: Full-Bleed Country Flag */}
                  <img
                    src={`/flags/${c.code.toLowerCase()}.svg`}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    className={`pointer-events-none absolute inset-0 z-0 size-full saturate-[1.06] transition-transform duration-700 ease-out group-hover:scale-[1.07] ${flagCfg.objectClass}`}
                  />

                  {/* Layer 2: Luxury Smoked Vignette & Specular Scrim (preserves vibrant flag in upper-right while ensuring 100% legible text & logos) */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-[1]"
                    style={{
                      background:
                        'linear-gradient(155deg, rgba(8, 9, 13, 0.22) 0%, rgba(8, 9, 13, 0.48) 46%, rgba(6, 7, 11, 0.90) 100%), linear-gradient(0deg, rgba(6, 7, 11, 0.92) 0%, rgba(6, 7, 11, 0.34) 54%, rgba(6, 7, 11, 0.08) 100%)',
                    }}
                  />

                  {/* Subtle hover orange border ring */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-[2] rounded-3xl border border-transparent transition-colors duration-300 group-hover:border-[#FF5A00]/75"
                  />

                  {/* Layer 3: Foreground Header (Currency ISO Pill + Currency Symbol Orb) */}
                  <div className="relative z-10 flex items-center justify-between gap-2">
                    <span className="mono inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-[11px] font-bold tracking-wider text-white backdrop-blur-md">
                      <span className="size-1.5 rounded-full bg-[#FF5A00]" />
                      {c.currency}
                    </span>

                    <span className="display inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 px-2.5 text-lg font-bold text-white shadow-md backdrop-blur-md transition-all duration-300 group-hover:scale-105 group-hover:border-[#FF5A00] group-hover:bg-[#FF5A00]">
                      {c.symbol}
                    </span>
                  </div>

                  {/* Layer 4: Country Name + 4 Official Regional Provider Logos */}
                  <div className="relative z-10">
                    <p
                      className="display text-2xl font-bold tracking-tight text-white"
                      style={{ textShadow: '0 2px 12px rgba(0, 0, 0, 0.78)' }}
                    >
                      {c.name}
                    </p>

                    <div className="mt-3 flex items-center gap-2">
                      {providers.map((providerName) => (
                        <span
                          key={providerName}
                          className="inline-flex rounded-[10px] shadow-[0_6px_16px_rgba(0,0,0,0.45)] transition-transform duration-200 hover:scale-110"
                        >
                          <MethodLogo name={providerName} size={36} />
                        </span>
                      ))}
                    </div>
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
