import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AppLink } from '@/components/AppLink'

const PLANET_VIDEO_URL =
  'https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/e859f229-8ebd-43fb-a5a0-58006ba75327.mp4'

const ease = [0.22, 1, 0.36, 1] as const

function createStarRand(initial = 4219) {
  let s = initial
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * Pure-black starfield with a glowing violet planet rim arching across the top.
 * Desktop renders the looping planet-rim video with mix-blend-mode: screen;
 * mobile (< 900px), pre-load, and reduced-motion fall back to a static canvas arc.
 */
export function PlanetHero() {
  const starCanvasRef = useRef<HTMLCanvasElement>(null)
  const rimCanvasRef = useRef<HTMLCanvasElement>(null)
  const [videoReady, setVideoReady] = useState(false)
  const [allowVideo, setAllowVideo] = useState(false)

  useEffect(() => {
    const check = () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const desktop = window.innerWidth >= 900 && window.innerWidth >= window.innerHeight * 0.85
      setAllowVideo(!reduced && desktop)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Procedural static white starfield on canvas
  useEffect(() => {
    const canvas = starCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawStars = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth || 1
      const h = canvas.clientHeight || 1
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, w, h)

      // Deterministic pseudo-random stars so resizing doesn't flicker wildly
      const rand = createStarRand(4219)

      const count = Math.min(260, Math.max(110, Math.round((w * h) / 6500)))
      for (let i = 0; i < count; i++) {
        const x = rand() * w
        const y = rand() * h
        const r = rand() < 0.82 ? 0.85 : 1.35
        const alpha = 0.16 + rand() * 0.62
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`
        ctx.fill()
      }
    }

    drawStars()
    window.addEventListener('resize', drawStars)
    return () => window.removeEventListener('resize', drawStars)
  }, [])

  // Fallback violet planet-rim arc on canvas (visible until video loads, and on phones / reduced motion)
  useEffect(() => {
    const canvas = rimCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawRim = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth || 1
      const h = canvas.clientHeight || 1
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.clearRect(0, 0, w, h)

      // Large planet circle centered above the top edge so only the glowing lower rim arcs across the top
      const cx = w * 0.5
      const radius = Math.max(w * 0.56, 460)
      const cy = Math.min(h * 0.44, 380) - radius

      const outerGlow = ctx.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius + 110)
      outerGlow.addColorStop(0, 'rgba(0, 0, 0, 0)')
      outerGlow.addColorStop(0.55, 'rgba(255, 90, 0, 0.28)')
      outerGlow.addColorStop(0.72, 'rgba(255, 138, 61, 0.65)')
      outerGlow.addColorStop(0.82, 'rgba(255, 90, 0, 0.22)')
      outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')

      ctx.fillStyle = outerGlow
      ctx.fillRect(0, 0, w, h)

      // Crisp bright inner plasma arc
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.lineWidth = 3.2
      ctx.strokeStyle = 'rgba(255, 212, 176, 0.86)'
      ctx.shadowColor = '#FF5A00'
      ctx.shadowBlur = 22
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    drawRim()
    window.addEventListener('resize', drawRim)
    return () => window.removeEventListener('resize', drawRim)
  }, [])

  return (
    <section className="stage relative isolate flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-black px-4 pb-12 pt-28 sm:px-6 sm:pb-16 sm:pt-24">
      {/* Procedural white starfield */}
      <canvas ref={starCanvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-0 size-full" />

      {/* Fallback planet rim canvas (always behind video; stays visible on mobile / reduced motion) */}
      <canvas
        ref={rimCanvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[72vh] w-full transition-opacity duration-700"
        style={{ opacity: allowVideo && videoReady ? 0.12 : 1 }}
      />

      {/* Desktop glowing orange planet-rim video with screen blend so black stays transparent */}
      {allowVideo && (
        <video
          src={PLANET_VIDEO_URL}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden
          onCanPlay={() => setVideoReady(true)}
          className="pointer-events-none absolute inset-0 z-[2] size-full object-cover object-top transition-opacity duration-[800ms]"
          style={{
            mixBlendMode: 'screen',
            filter: 'hue-rotate(96deg) saturate(1.25) brightness(0.9)',
            opacity: videoReady ? 0.92 : 0,
          }}
        />
      )}

      {/* Centered Hero Copy & CTAs */}
      <div className="relative z-10 mt-14 flex w-full max-w-4xl flex-col items-center text-center sm:mt-36">
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease }}
          className="display text-balance text-[2.35rem] font-bold leading-[1.08] tracking-tight text-[#f7f7f8] sm:text-6xl lg:text-[78px]"
        >
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(95deg, #ff8c42 0%, #FF5A00 55%, #ffb380 100%)' }}
          >
            OnPeer
          </span>{' '}
          Trade Smarter,
          <br />
          Faster, Safer.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.14, ease }}
          className="mt-6 max-w-2xl text-pretty text-sm leading-relaxed sm:text-base"
          style={{ color: '#8b8988' }}
        >
          The first fully integrated South Asian USDC marketplace. Trade P2P with local payment apps, swap stablecoins,
          and bridge across chains directly from your wallet on Arc Testnet.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.26, ease }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3.5"
        >
          <AppLink
            to="/p2p"
            className="inline-flex min-h-[48px] items-center justify-center rounded-full px-7 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(255,90,0,0.65)] active:scale-[0.98]"
            style={{ background: 'linear-gradient(95deg, #e04e00 0%, #FF5A00 100%)' }}
          >
            Get Started
          </AppLink>

          <a
            href="#products-title"
            className="inline-flex min-h-[48px] items-center justify-center rounded-full px-7 text-sm font-semibold text-[#f7f7f8] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#FF5A00]/60 hover:bg-white/[0.12] active:scale-[0.98]"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
            }}
          >
            Learn More
          </a>
        </motion.div>
      </div>
    </section>
  )
}
