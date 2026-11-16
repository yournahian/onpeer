import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * A soft light that follows the pointer while it is over the parent section.
 *
 * The light is a viewport-sized fixed layer mounted on document.body, not a box the size of the section.
 * A box the size of the section clips the radial gradient at its own edges, which showed up as a hard
 * vertical seam whenever the pointer neared the left or right side. A viewport layer has no inner edges,
 * the portal keeps any transformed ancestor from turning "fixed" into "relative to that ancestor", and the
 * pointer position is used as-is (clientX/clientY) so the glow stays centred on the cursor to the corners.
 * Skipped on touch screens.
 */
export function CursorGlow() {
  const marker = useRef<HTMLSpanElement>(null)
  const glow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = glow.current
    const parent = marker.current?.parentElement
    if (!el || !parent || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const move = (e: PointerEvent) => {
      el.style.setProperty('--gx', `${e.clientX}px`)
      el.style.setProperty('--gy', `${e.clientY}px`)
      el.style.opacity = '1'
    }
    const leave = () => {
      el.style.opacity = '0'
    }
    parent.addEventListener('pointermove', move)
    parent.addEventListener('pointerleave', leave)
    return () => {
      parent.removeEventListener('pointermove', move)
      parent.removeEventListener('pointerleave', leave)
    }
  }, [])
  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <div
          ref={glow}
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 opacity-0 transition-opacity duration-500"
          style={{ background: 'radial-gradient(520px circle at var(--gx, 50%) var(--gy, 50%), var(--accent-glow), transparent 60%)' }}
        />,
        document.body,
      )}
    </>
  )
}
