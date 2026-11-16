import { useId } from 'react'
import { AppLink } from '@/components/AppLink'

/** OnPeer mark: two linked rings, one person on each side of the trade. */
export function LogoMark({ size = 40 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c084fc" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="48" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f472b6" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="#12081f" />
      <circle cx="19" cy="24" r="9.5" stroke={`url(#${id}-a)`} strokeWidth="3.5" />
      <circle cx="29" cy="24" r="9.5" stroke={`url(#${id}-b)`} strokeWidth="3.5" strokeOpacity="0.95" />
    </svg>
  )
}

/** Logo mark plus wordmark, linking home. */
export function Brand({ tagline }: { tagline?: string }) {
  return (
    <AppLink to="/" aria-label="OnPeer home" className="group flex items-center gap-3">
      <span className="glow-accent rounded-xl transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-105">
        <LogoMark size={40} />
      </span>
      <span className="leading-tight">
        <span className="script block text-2xl leading-tight" style={{ color: 'var(--accent)', textShadow: '0 0 18px var(--accent-glow)' }}>OnPeer</span>
        {tagline && (
          <span className="block text-xs" style={{ color: 'var(--subtle)' }}>
            {tagline}
          </span>
        )}
      </span>
    </AppLink>
  )
}
