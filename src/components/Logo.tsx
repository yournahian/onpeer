import { AppLink } from '@/components/AppLink'
import { isAppSubdomain, LANDING_URL } from '@/lib/router'

/** Official OnPeer brand mark from OnPeer_Brandkit. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/brand/onpeer-app-orange.svg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className="shrink-0 rounded-xl object-cover"
      style={{ width: size, height: size }}
    />
  )
}

/** Logo mark plus wordmark, linking home. */
export function Brand({ tagline }: { tagline?: string }) {
  return (
    <AppLink to={isAppSubdomain() ? LANDING_URL : '/'} aria-label="OnPeer home" className="group flex items-center gap-3">
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
