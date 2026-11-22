import { useEffect } from 'react'
import Lenis from 'lenis'

/**
 * Activates Lenis smooth scroll on mount and destroys it on unmount.
 * Only use on the landing page — app pages (P2P, Swap, etc.) don't need it.
 *
 * Settings tuned for a buttery-smooth feel without feeling sluggish:
 * - duration 1.1s  → slightly longer than default for a more "luxurious" feel
 * - easing: exponential ease-out → fast start, smooth deceleration
 * - smoothWheel: true → applies lerp to native scroll wheel
 */
export function useLenis() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return // respect accessibility preference

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => 1 - Math.pow(1 - t, 4), // easeOutQuart
      smoothWheel: true,
      touchMultiplier: 1.5,
      infinite: false,
    })

    let raf = 0
    const loop = (time: number) => {
      lenis.raf(time)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
    }
  }, [])
}
