import { useEffect } from 'react'
import Lenis from 'lenis'

/**
 * Activates Lenis smooth scroll on mount and destroys it on unmount.
 * Only use on the landing page — app pages (P2P, Swap, etc.) don't need it.
 *
 * Lenis uses window.scrollTo() under the hood (not CSS transform),
 * so position:fixed elements (navbar, bottom-nav) are unaffected.
 *
 * We also emit a native 'scroll' event on each Lenis frame so that
 * Framer Motion's useScroll() stays in sync with the lerped position.
 */
export function useLenis() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return // respect accessibility preference

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => 1 - Math.pow(1 - t, 4), // easeOutQuart
      smoothWheel: true,
      allowNestedScroll: true,
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
