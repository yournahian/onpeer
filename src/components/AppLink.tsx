import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { APP_URL, isLandingDomain, navigate } from '@/lib/router'

const APP_PREFIXES = ['/p2p', '/swap', '/bridge', '/admin', '/assistant']

function resolveHref(to: string): { href: string; external: boolean } {
  if (to.startsWith('http://') || to.startsWith('https://')) {
    return { href: to, external: true }
  }
  if (isLandingDomain() && APP_PREFIXES.some((p) => to.startsWith(p))) {
    return { href: `${APP_URL}${to}`, external: true }
  }
  return { href: to, external: false }
}

/** In-app link: client-side navigation, but still a real anchor for keyboard and open-in-new-tab. */
export function AppLink({
  to,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { href, external } = resolveHref(to)
  return (
    <a
      {...rest}
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (external || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    />
  )
}
