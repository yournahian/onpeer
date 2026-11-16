import type { ReactNode } from 'react'

/** Card with a light that follows the cursor across its surface. */
export function SpotlightCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`spotlight ${className}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
        e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
      }}
    >
      {children}
    </div>
  )
}
