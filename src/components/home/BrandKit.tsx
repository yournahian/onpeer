import { Copy, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Reveal } from '@/components/fx/Reveal'

const LOGOS = [
  {
    name: 'Primary Mark',
    desc: 'White symbol on OnPeer Orange',
    previewBg: '#FF5A00',
    img: '/brand/onpeer-app-orange.svg',
    downloads: [
      { label: 'SVG', href: '/brand/onpeer-logo-orange.svg', file: 'OnPeer-White-Orange.svg' },
      { label: 'PNG', href: '/brand/onpeer-logo-orange-1024.png', file: 'OnPeer-White-Orange-1024.png' },
    ],
  },
  {
    name: 'Charcoal Mark',
    desc: 'White symbol on dark surface',
    previewBg: '#151515',
    img: '/brand/onpeer-app-dark.svg',
    downloads: [{ label: 'SVG', href: '/brand/onpeer-app-dark.svg', file: 'onpeer-app-dark.svg' }],
  },
  {
    name: 'Horizontal (Dark)',
    desc: 'Full lockup for dark backgrounds',
    previewBg: '#0a0612',
    img: '/brand/onpeer-horizontal-white.svg',
    wide: true,
    downloads: [{ label: 'SVG', href: '/brand/onpeer-horizontal-white.svg', file: 'onpeer-horizontal-white.svg' }],
  },
  {
    name: 'Horizontal (Light)',
    desc: 'Full lockup for light backgrounds',
    previewBg: '#FFFFFF',
    img: '/brand/onpeer-horizontal-black.svg',
    wide: true,
    downloads: [{ label: 'SVG', href: '/brand/onpeer-horizontal-black.svg', file: 'onpeer-horizontal-black.svg' }],
  },
] as const

const PALETTE = [
  { name: 'OnPeer Orange', hex: '#FF5A00', darkText: false },
  { name: 'Pure White', hex: '#FFFFFF', darkText: true },
  { name: 'Charcoal', hex: '#151515', darkText: false },
  { name: 'Obsidian Black', hex: '#000000', darkText: false },
] as const

export function BrandKit() {
  const copyHex = (hex: string, name: string) => {
    void navigator.clipboard?.writeText(hex)
    toast.success(`Copied ${name} (${hex})`)
  }

  return (
    <section id="brand-kit" className="mt-24" aria-labelledby="brand-kit-title">
      <Reveal>
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
          Brand kit
        </p>
        <h2 id="brand-kit-title" className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-5xl">
          Logos, marks and brand colours
        </h2>
        <p className="mt-3 text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
          Official OnPeer brand assets for partners, listings and media. Download vector SVGs or copy our core palette.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LOGOS.map((item, i) => (
          <Reveal key={item.name} delay={i * 0.06} className="h-full">
            <div className="glass flex h-full flex-col rounded-3xl p-4">
              <div
                className="flex h-32 items-center justify-center overflow-hidden rounded-2xl border p-4"
                style={{ background: item.previewBg, borderColor: 'var(--border)' }}
              >
                <img
                  src={item.img}
                  alt={item.name}
                  loading="lazy"
                  className={'wide' in item && item.wide ? 'max-h-12 w-auto object-contain' : 'size-16 rounded-xl object-contain'}
                />
              </div>
              <div className="mt-4 flex-1">
                <h3 className="display text-base font-bold">{item.name}</h3>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                  {item.desc}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {item.downloads.map((d) => (
                  <a
                    key={d.label}
                    href={d.href}
                    download={d.file}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)]"
                    style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                  >
                    <Download className="size-3" />
                    {d.label}
                  </a>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.12}>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PALETTE.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => copyHex(c.hex, c.name)}
              className="glass lift flex items-center justify-between rounded-2xl p-3.5 text-left"
            >
              <span className="flex items-center gap-3">
                <span
                  className="size-9 shrink-0 rounded-xl border"
                  style={{ background: c.hex, borderColor: 'var(--border-strong)' }}
                />
                <span>
                  <span className="block text-sm font-bold">{c.name}</span>
                  <span className="mono block text-xs" style={{ color: 'var(--subtle)' }}>
                    {c.hex}
                  </span>
                </span>
              </span>
              <Copy className="size-4 opacity-60" />
            </button>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
