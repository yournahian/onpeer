import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate } from '@/lib/router'

/** In-app link: client-side navigation, but still a real anchor for keyboard and open-in-new-tab. */
export function AppLink({
  to,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    />
  )
}
