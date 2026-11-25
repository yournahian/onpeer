import { useRoute } from '@/lib/router'
import { FooterCta } from '@/components/FooterCta'
import { CinematicFooter } from '@/components/ui/motion-footer'

/** Site footer: pairs the South Asia corridor CTA on Home with the curtain-reveal CinematicFooter. */
export function Footer() {
  const route = useRoute()
  return (
    <div className="relative mt-20">
      {route === 'home' && <FooterCta />}
      <CinematicFooter />
    </div>
  )
}
