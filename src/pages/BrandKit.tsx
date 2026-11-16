import { Check, Copy, Download, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { SiteBar } from '@/components/SiteBar'
import { Reveal } from '@/components/fx/Reveal'

const LOGOS = [
  {
    name: 'Primary Mark',
    desc: 'White symbol on OnPeer Orange (#FF5A00). Use as the default app icon and brand avatar.',
    previewBg: '#FF5A00',
    img: '/brand/onpeer-app-orange.svg',
    downloads: [
      { label: 'SVG', href: '/brand/onpeer-logo-orange.svg', file: 'OnPeer-White-Orange.svg' },
      { label: 'PNG (1024px)', href: '/brand/onpeer-logo-orange-1024.png', file: 'OnPeer-White-Orange-1024.png' },
    ],
  },
  {
    name: 'Charcoal Mark',
    desc: 'White symbol on Charcoal (#151515). Ideal for dark interfaces and monochrome badges.',
    previewBg: '#151515',
    img: '/brand/onpeer-app-dark.svg',
    downloads: [{ label: 'SVG', href: '/brand/onpeer-app-dark.svg', file: 'onpeer-app-dark.svg' }],
  },
  {
    name: 'Horizontal Lockup (Dark)',
    desc: 'Full wordmark + symbol lockup for dark backgrounds, headers and partner banners.',
    previewBg: '#0a0a0a',
    img: '/brand/onpeer-horizontal-white.svg',
    wide: true,
    downloads: [{ label: 'SVG', href: '/brand/onpeer-horizontal-white.svg', file: 'onpeer-horizontal-white.svg' }],
  },
  {
    name: 'Horizontal Lockup (Light)',
    desc: 'Full wordmark + symbol lockup for white or light-colored surfaces and documents.',
    previewBg: '#FFFFFF',
    img: '/brand/onpeer-horizontal-black.svg',
    wide: true,
    downloads: [{ label: 'SVG', href: '/brand/onpeer-horizontal-black.svg', file: 'onpeer-horizontal-black.svg' }],
  },
] as const

const PALETTE = [
  { name: 'OnPeer Orange', hex: '#FF5A00', rgb: '255, 90, 0', cmyk: '0, 65, 100, 0', role: 'Primary brand & CTA accent' },
  { name: 'Pure White', hex: '#FFFFFF', rgb: '255, 255, 255', cmyk: '0, 0, 0, 0', role: 'Primary dark-mode text & symbol fill' },
  { name: 'Charcoal', hex: '#151515', rgb: '21, 21, 21', cmyk: '0, 0, 0, 92', role: 'Elevated cards, panels & light-mode ink' },
  { name: 'Obsidian Black', hex: '#000000', rgb: '0, 0, 0', cmyk: '0, 0, 0, 100', role: 'Deep canvas background' },
] as const

const DO_LIST = [
  'Keep clear space around the mark equal to at least 25% of its width.',
  'Use the white lockup on dark backgrounds and the black lockup on light backgrounds.',
  'Use #FF5A00 as the primary accent for highlights, CTAs, and brand callouts.',
]

const DONT_LIST = [
  'Do not stretch, skew, rotate, or recolor the OnPeer symbol.',
  'Do not place the white symbol on light backgrounds without a container.',
  'Do not add heavy drop shadows or outlines over the horizontal wordmark.',
]

export default function BrandKitPage() {
  const copyHex = (hex: string, name: string) => {
    void navigator.clipboard?.writeText(hex)
    toast.success(`Copied ${name} (${hex})`)
  }

  return (
    <div className="min-h-dvh pb-24">
      <SiteBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
            Brand kit
          </p>
          <h1 className="display text-gradient mt-2 text-balance text-4xl font-bold sm:text-6xl">
            OnPeer Brand Guidelines &amp; Assets
          </h1>
          <p className="mt-3 max-w-2xl text-pretty text-sm sm:text-base" style={{ color: 'var(--muted)' }}>
            Official logos, app icons, colour tokens, and usage rules for OnPeer. Download production-ready SVG and PNG
            assets for partner listings, press, and integrations.
          </p>
        </Reveal>

        {/* Logos & Lockups */}
        <section className="mt-14" aria-labelledby="logos-title">
          <h2 id="logos-title" className="display text-2xl font-bold sm:text-3xl">
            Logos &amp; Lockups
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LOGOS.map((item, i) => (
              <Reveal key={item.name} delay={i * 0.05} className="h-full">
                <div className="glass flex h-full flex-col rounded-3xl p-4">
                  <div
                    className="flex h-36 items-center justify-center overflow-hidden rounded-2xl border p-4"
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
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                      {item.desc}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.downloads.map((d) => (
                      <a
                        key={d.label}
                        href={d.href}
                        download={d.file}
                        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)]"
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
        </section>

        {/* Color Palette */}
        <section className="mt-16" aria-labelledby="palette-title">
          <h2 id="palette-title" className="display text-2xl font-bold sm:text-3xl">
            Brand Palette
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Click any swatch to copy its HEX code.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => copyHex(c.hex, c.name)}
                className="glass lift flex flex-col justify-between rounded-3xl p-4 text-left"
              >
                <div
                  className="flex h-24 w-full items-start justify-end rounded-2xl border p-3"
                  style={{ background: c.hex, borderColor: 'var(--border-strong)' }}
                >
                  <span
                    className="inline-flex size-7 items-center justify-center rounded-full"
                    style={{ background: 'rgba(0,0,0,0.28)', color: '#fff' }}
                  >
                    <Copy className="size-3.5" />
                  </span>
                </div>
                <div className="mt-4">
                  <p className="display text-base font-bold">{c.name}</p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                    {c.role}
                  </p>
                  <div className="mono mt-3 space-y-0.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
                    <p>HEX: {c.hex}</p>
                    <p>RGB: {c.rgb}</p>
                    <p>CMYK: {c.cmyk}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Social & App Icons + Usage Rules */}
        <section className="mt-16 grid gap-6 lg:grid-cols-2">
          <div className="glass rounded-3xl p-6">
            <h2 className="display flex items-center gap-2 text-xl font-bold">
              <ShieldCheck className="size-5" style={{ color: 'var(--success)' }} /> Do&apos;s
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm" style={{ color: 'var(--muted)' }}>
              {DO_LIST.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--success)' }} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass rounded-3xl p-6">
            <h2 className="display flex items-center gap-2 text-xl font-bold">
              <X className="size-5" style={{ color: 'var(--danger)' }} /> Don&apos;ts
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm" style={{ color: 'var(--muted)' }}>
              {DONT_LIST.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <X className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
